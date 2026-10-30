import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { pushToOwners } from "@/lib/push-notify";

/**
 * Telling the owners something happened: a push to their phones and an entry in
 * their bell. Server-only.
 *
 * The bell has to be written here as well as the push sent, because a push is
 * gone the moment it is swiped away and an owner who was not looking at their
 * phone has nothing to come back to. The entry is read by useBellInbox, which
 * also lets it expire.
 */

/** The `kind` of a notice written to an owner's own record about a roster publish. */
export const OWNER_ROSTER_KIND = "roster-published-owner";

export type OwnerAnnouncement = {
  title: string;
  detail: string;
  /** Where tapping the push lands, and where the bell entry leads. */
  url: string;
  /** The person who did it; they are not told. */
  excludeUid?: string;
};

export async function announceRosterToOwners(a: OwnerAnnouncement): Promise<{ owners: number }> {
  const owners = await adminDb().collection("staff_onboarding").where("role", "==", "owner").get();
  const notice = {
    id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    kind: OWNER_ROSTER_KIND,
    title: a.title,
    detail: a.detail,
    createdAt: Timestamp.now(),
  };

  let written = 0;
  await Promise.all(
    owners.docs
      .filter((d) => d.id !== a.excludeUid)
      .map(async (d) => {
        await d.ref.update({ notifications: FieldValue.arrayUnion(notice) });
        written += 1;
      }),
  );

  // The push is a side effect of the publish that mattered: never fail it.
  await pushToOwners(
    { title: a.title, body: a.detail, url: a.url },
    { excludeUid: a.excludeUid },
  ).catch((err) => console.error("[owner-announce] push failed:", err));

  return { owners: written };
}
