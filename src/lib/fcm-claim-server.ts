import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";

/**
 * Make a device token belong to one person. Server-only.
 *
 * Takes the token off every staff record except `uid`'s own, and returns how
 * many it was taken from. See `claimFcmToken` in lib/fcm for why a phone must
 * not stay registered on everyone who ever signed in on it.
 *
 * Refuses to act unless the token really is on `uid`'s record: a caller can only
 * claim a device they have just registered, not take somebody else's.
 */
export async function claimDeviceToken(uid: string, token: string): Promise<number | null> {
  const mine = await adminDb().collection("staff_onboarding").doc(uid).get();
  const owned: unknown = mine.data()?.fcmTokens;
  if (!Array.isArray(owned) || !owned.includes(token)) return null;

  const holders = await adminDb()
    .collection("staff_onboarding")
    .where("fcmTokens", "array-contains", token)
    .get();

  let removed = 0;
  for (const d of holders.docs) {
    if (d.id === uid) continue;
    await d.ref.update({ fcmTokens: FieldValue.arrayRemove(token) });
    removed += 1;
  }
  return removed;
}
