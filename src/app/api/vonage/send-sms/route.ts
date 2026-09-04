import { NextResponse, type NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { OWNER_USERNAMES } from "@/lib/permissions";
import { emailToUsername } from "@/lib/username";

/**
 * POST /api/vonage/send-sms
 * Header:  Authorization: Bearer <Firebase ID token of an owner>
 * Body:    { to: "0450991522" | "61450991522", text: "message body" }
 *
 * Fires a single SMS through Vonage's legacy SMS API. Sender defaults
 * to the alphanumeric ID (`YURICA`), falling back to the leased AU
 * number if only that is configured. Never called from the browser —
 * the API secret must stay server-side.
 */

const VONAGE_ENDPOINT = "https://rest.nexmo.com/sms/json";

type VonageMsg = { status?: string; "message-id"?: string; "error-text"?: string };

/**
 * GSM 03.38 — everything an SMS can carry in seven bits, including the
 * characters reachable through the escape table (the last handful).
 *
 * Written out rather than approximated with a regex range because the set is
 * genuinely arbitrary: it holds `£`, `Ø` and `Ξ` but not `"` curly quotes,
 * `—` or any emoji.
 */
const GSM_ALPHABET = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
    "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà" +
    "\f^{}\\[~]|€",
);

/**
 * Whether this message has to travel as UCS-2.
 *
 * Vonage defaults to `type=text`, which is GSM-7, and silently replaces
 * anything outside that alphabet with "?". Asking for unicode fixes that at a
 * cost worth knowing about: a UCS-2 message fits 70 characters where GSM-7
 * fits 160, and 67 against 153 once it is long enough to be split. One stray
 * character therefore roughly doubles what a long message costs to send.
 *
 * Hence per message rather than unicode across the board — and hence a
 * safety net rather than a licence. The welcome text is written in plain
 * ASCII precisely so it never lands here; a caller that trips this is buying
 * twice the segments, which is fine for a one-off but not for anything sent
 * on every hire. Callers stay silently correct either way: mangled text is
 * the one outcome this rules out.
 */
function smsNeedsUnicode(text: string): boolean {
  for (const ch of text) {
    if (!GSM_ALPHABET.has(ch)) return true;
  }
  return false;
}

async function verifyOwner(
  req: NextRequest,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const idToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!idToken) return { ok: false, status: 401, error: "Missing bearer token." };
  try {
    const decoded = await adminAuth().verifyIdToken(idToken);
    const username = emailToUsername(decoded.email ?? "").toLowerCase();
    if (!OWNER_USERNAMES.has(username)) {
      return { ok: false, status: 403, error: "Owner only." };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      status: 401,
      error: `Token verification failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Coerce whatever we've been handed into E.164 without the leading `+`. */
function normaliseAuMobile(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("61")) return digits;
  if (digits.startsWith("0")) return "61" + digits.slice(1);
  if (digits.length === 9) return "61" + digits; // e.g. "450991522"
  return digits;
}

export async function POST(req: NextRequest) {
  const auth = await verifyOwner(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const apiKey = process.env.VONAGE_API_KEY;
  const apiSecret = process.env.VONAGE_API_SECRET;
  const sender = process.env.VONAGE_SENDER_ID || process.env.VONAGE_FROM_NUMBER;
  if (!apiKey || !apiSecret || !sender) {
    return NextResponse.json({ error: "Vonage credentials not configured." }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const toRaw = String(body?.to ?? "").trim();
  const text = String(body?.text ?? "").trim();
  if (!toRaw || !text) {
    return NextResponse.json({ error: "Missing to or text." }, { status: 400 });
  }
  const to = normaliseAuMobile(toRaw);
  if (to.length < 10) {
    return NextResponse.json({ error: "Invalid mobile number." }, { status: 400 });
  }

  const params = new URLSearchParams({
    api_key: apiKey,
    api_secret: apiSecret,
    from: sender,
    to,
    text,
    type: smsNeedsUnicode(text) ? "unicode" : "text",
  });

  try {
    const upstream = await fetch(VONAGE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const data = (await upstream.json().catch(() => ({}))) as { messages?: VonageMsg[] };
    const msg = data.messages?.[0];
    // Vonage always returns HTTP 200; success is signalled by
    // messages[0].status === "0". Anything else is a delivery error.
    if (!msg || msg.status !== "0") {
      const err = msg?.["error-text"] ?? "Vonage send failed.";
      console.error("[vonage/send-sms] non-zero status:", msg);
      return NextResponse.json({ error: err }, { status: 502 });
    }
    return NextResponse.json({ ok: true, messageId: msg["message-id"] ?? null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Vonage unreachable.";
    console.error("[vonage/send-sms] failed:", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
