import { NextResponse, type NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { mirrorReservation, mirrorReservations } from "@/lib/reservations-mirror";

/**
 * Proxy to the yurica-system booking platform's admin API.
 *  GET  /api/reservations?date=YYYY-MM-DD&branch=northsydney → list
 *  POST /api/reservations  body = create payload                → create
 *
 * Keeps the booking origin server-side so the browser never talks to it
 * directly, and gates calls on a Firebase ID token.
 */
const BOOKING_API = "https://australia-southeast1-yurica-system.cloudfunctions.net/bookingApi";
/**
 * The booking platform's CORS middleware crashes (TypeError: Invalid URL)
 * when no Origin header is present — it falls back to "*" and tries
 * `new URL("*")`. Server-side fetch doesn't send Origin by default, so
 * spoof a value that's already on its allowlist.
 */
const SPOOF_ORIGIN = "https://book.admin.yurica.com.au";

async function verifyAuth(req: NextRequest) {
  const idToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!idToken) return { ok: false as const, status: 401, error: "Missing bearer token." };
  try {
    await adminAuth().verifyIdToken(idToken);
    return { ok: true as const };
  } catch (err) {
    return {
      ok: false as const,
      status: 401,
      error: `Token verification failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? "";
  const branch = url.searchParams.get("branch") ?? "northsydney";
  if (!date) return NextResponse.json({ error: "Missing ?date=YYYY-MM-DD" }, { status: 400 });
  try {
    const upstream = await fetch(
      `${BOOKING_API}/reservations?date=${encodeURIComponent(date)}&branch=${encodeURIComponent(branch)}`,
      { cache: "no-store", headers: { Origin: SPOOF_ORIGIN } },
    );
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return NextResponse.json(
        { error: data?.error ?? `Booking API failed (${upstream.status})` },
        { status: upstream.status },
      );
    }
    return NextResponse.json({ reservations: data?.reservations ?? [] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Booking API unreachable.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }
  try {
    const upstream = await fetch(`${BOOKING_API}/reservations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: SPOOF_ORIGIN },
      body: JSON.stringify(body),
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return NextResponse.json(
        { error: data?.error ?? `Booking API failed (${upstream.status})` },
        { status: upstream.status },
      );
    }
    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Booking API unreachable.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
