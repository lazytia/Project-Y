import { adminDb, adminMessaging } from "@/lib/firebase-admin";

/**
 * Sending a push to somebody's phone. Server-only — imports firebase-admin.
 *
 * Lives here rather than inside /api/staff/notify because that route is no
 * longer the only sender: signing in for the first time wakes the owner's
 * phone from the session route as well. Two copies of "read fcmTokens, send,
 * prune the dead ones" would have meant fixing token pruning twice.
 */

const STAFF_COLLECTION = "staff_onboarding";

/** Token errors that mean the device is gone, not that the send misfired. */
const DEAD_TOKEN_CODES = new Set([
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered",
]);

export type PushMessage = {
  title: string;
  body: string;
  /** Where tapping the notification lands. */
  url: string;
};

export type PushResult = {
  delivered: number;
  failed: number;
  /** Set when nothing was attempted, for the caller to pass back verbatim. */
  reason?: string;
};

function tokensOf(data: FirebaseFirestore.DocumentData | undefined): string[] {
  const raw = data?.fcmTokens;
  if (!Array.isArray(raw)) return [];
  return raw.filter((t: unknown): t is string => typeof t === "string" && t.length > 0);
}

/**
 * Push to every device one person has registered.
 *
 * Sent DATA-ONLY so the service worker's own push handler displays it, which
 * is the path that works in an iOS Safari PWA.
 */
export async function pushToUid(uid: string, message: PushMessage): Promise<PushResult> {
  const ref = adminDb().collection(STAFF_COLLECTION).doc(uid);
  const snap = await ref.get();
  if (!snap.exists) return { delivered: 0, failed: 0, reason: "Staff not found" };

  const tokens = tokensOf(snap.data());
  if (tokens.length === 0) {
    return { delivered: 0, failed: 0, reason: "No FCM tokens for that staff." };
  }

  const res = await adminMessaging().sendEachForMulticast({
    tokens,
    data: { title: message.title, body: message.body, url: message.url },
  });

  const dead = new Set<string>();
  res.responses.forEach((r, i) => {
    if (!r.success && r.error && DEAD_TOKEN_CODES.has(r.error.code)) {
      const token = tokens[i];
      if (token) dead.add(token);
    }
  });
  if (dead.size > 0) {
    const remaining = tokens.filter((t) => !dead.has(t));
    await ref.update({ fcmTokens: remaining }).catch(() => {
      /* pruning is housekeeping — never fail a delivered send over it */
    });
  }

  return { delivered: res.successCount, failed: res.failureCount };
}

/**
 * Push to everyone who owns the business.
 *
 * Read off the same collection as everything else, by role, so an owner who
 * is added later needs no change here. Failures are swallowed per-owner: this
 * is always a side effect of something more important, and half a delivery
 * beats aborting the thing that triggered it.
 */
export async function pushToOwners(message: PushMessage): Promise<PushResult> {
  const snap = await adminDb()
    .collection(STAFF_COLLECTION)
    .where("role", "==", "owner")
    .get();

  let delivered = 0;
  let failed = 0;
  for (const doc of snap.docs) {
    const res = await pushToUid(doc.id, message).catch(() => null);
    if (!res) continue;
    delivered += res.delivered;
    failed += res.failed;
  }
  return { delivered, failed };
}
