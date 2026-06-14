import { NextRequest, NextResponse } from "next/server";
import { adminDb, adminMessaging } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

const NOTIFICATION_TITLE = "Onboarding Reminder";
const NOTIFICATION_BODY =
  "Please submit your onboarding documents as soon as possible.";
const LANDING_URL = "/onboarding";

export async function POST(req: NextRequest) {
  let body: { uid?: string; uids?: string[]; message?: string };
  try {
    body = (await req.json()) as { uid?: string; uids?: string[]; message?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const uids = Array.from(
    new Set(
      [
        ...(body.uids ?? []),
        ...(body.uid ? [body.uid] : []),
      ]
        .map((u) => (typeof u === "string" ? u.trim() : ""))
        .filter((u) => u.length > 0),
    ),
  );
  if (uids.length === 0) {
    return NextResponse.json({ error: "uid is required" }, { status: 400 });
  }

  // Collect tokens for every requested uid. Track which doc each token came
  // from so we can prune invalid ones afterwards.
  const tokenOwners = new Map<string, string>(); // token → uid
  for (const u of uids) {
    const snap = await adminDb().collection("staff_onboarding").doc(u).get();
    if (!snap.exists) continue;
    const data = snap.data() ?? {};
    if (Array.isArray(data.fcmTokens)) {
      for (const t of data.fcmTokens) {
        if (typeof t === "string" && t.length > 0 && !tokenOwners.has(t)) {
          tokenOwners.set(t, u);
        }
      }
    }
  }
  const tokens = Array.from(tokenOwners.keys());

  if (tokens.length === 0) {
    return NextResponse.json(
      {
        delivered: 0,
        reason: "No FCM tokens — open the app and allow notifications first.",
      },
      { status: 200 },
    );
  }

  const messageBody = body.message?.trim() || NOTIFICATION_BODY;

  // IMPORTANT (iOS): send a DATA-ONLY message. iOS Safari PWAs do not reliably
  // auto-display messages that carry a top-level `notification` block — the
  // FCM compat SDK's onBackgroundMessage auto-display path frequently never
  // fires. Instead we put everything in `data` and let our service worker's
  // explicit `push` event handler call showNotification() itself, which DOES
  // fire on iOS. No top-level `notification` => no double display.
  const res = await adminMessaging().sendEachForMulticast({
    tokens,
    data: {
      title: NOTIFICATION_TITLE,
      body: messageBody,
      url: LANDING_URL,
    },
  });

  // Drop tokens the FCM server reports as invalid. Group by owning doc so we
  // can update each doc's fcmTokens array independently.
  const invalidByDoc = new Map<string, Set<string>>();
  res.responses.forEach((r, i) => {
    if (
      !r.success &&
      r.error &&
      [
        "messaging/invalid-registration-token",
        "messaging/registration-token-not-registered",
      ].includes(r.error.code)
    ) {
      const token = tokens[i];
      const owner = tokenOwners.get(token);
      if (!owner) return;
      const set = invalidByDoc.get(owner) ?? new Set<string>();
      set.add(token);
      invalidByDoc.set(owner, set);
    }
  });
  for (const [owner, badSet] of invalidByDoc) {
    const ownerSnap = await adminDb().collection("staff_onboarding").doc(owner).get();
    const ownerData = ownerSnap.data() ?? {};
    const current: string[] = Array.isArray(ownerData.fcmTokens)
      ? ownerData.fcmTokens.filter((t: unknown): t is string => typeof t === "string")
      : [];
    const remaining = current.filter((t) => !badSet.has(t));
    if (remaining.length !== current.length) {
      await adminDb()
        .collection("staff_onboarding")
        .doc(owner)
        .update({ fcmTokens: remaining });
    }
  }

  return NextResponse.json({
    delivered: res.successCount,
    failed: res.failureCount,
  });
}
