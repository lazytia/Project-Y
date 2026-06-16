import { NextRequest, NextResponse } from "next/server";
import { adminDb, adminMessaging } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

/**
 * Generic push notification to a single staff member. Used by manager-side
 * actions (approve/decline a request, etc.) to wake the staff's phone.
 *
 * Body: { uid: string; title?: string; body?: string; url?: string }
 *
 * The message is sent DATA-ONLY so the service worker's explicit push
 * handler displays it — matches the iOS Safari PWA path that the existing
 * /api/staff/remind endpoint uses.
 */
export async function POST(req: NextRequest) {
  let body: { uid?: string; title?: string; body?: string; url?: string };
  try {
    body = (await req.json()) as {
      uid?: string;
      title?: string;
      body?: string;
      url?: string;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const uid = typeof body.uid === "string" ? body.uid.trim() : "";
  if (!uid) {
    return NextResponse.json({ error: "uid is required" }, { status: 400 });
  }

  const title = (body.title ?? "").trim() || "Project Y";
  const messageBody = (body.body ?? "").trim();
  const url = (body.url ?? "").trim() || "/staff";

  const snap = await adminDb().collection("staff_onboarding").doc(uid).get();
  if (!snap.exists) {
    return NextResponse.json(
      { delivered: 0, reason: "Staff not found" },
      { status: 200 },
    );
  }
  const data = snap.data() ?? {};
  const tokens: string[] = Array.isArray(data.fcmTokens)
    ? data.fcmTokens.filter((t: unknown): t is string => typeof t === "string" && t.length > 0)
    : [];

  if (tokens.length === 0) {
    return NextResponse.json(
      { delivered: 0, reason: "No FCM tokens for that staff." },
      { status: 200 },
    );
  }

  const res = await adminMessaging().sendEachForMulticast({
    tokens,
    data: {
      title,
      body: messageBody,
      url,
    },
  });

  // Prune invalid tokens.
  const invalid = new Set<string>();
  res.responses.forEach((r, i) => {
    if (
      !r.success &&
      r.error &&
      [
        "messaging/invalid-registration-token",
        "messaging/registration-token-not-registered",
      ].includes(r.error.code)
    ) {
      const tok = tokens[i];
      if (tok) invalid.add(tok);
    }
  });
  if (invalid.size > 0) {
    const remaining = tokens.filter((t) => !invalid.has(t));
    if (remaining.length !== tokens.length) {
      await adminDb()
        .collection("staff_onboarding")
        .doc(uid)
        .update({ fcmTokens: remaining });
    }
  }

  return NextResponse.json({
    delivered: res.successCount,
    failed: res.failureCount,
  });
}
