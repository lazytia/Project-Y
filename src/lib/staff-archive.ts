/* ──────────────────────────────────────────────────────────────────────
 * A copy of a staff record, kept whenever one is deleted.
 *
 * Deleting a staff record is a hard delete in Firestore, and on 2026-11-24
 * two new hires went off New Employees with nobody able to say how: the
 * database keeps no history, the app wrote no record of the press, and by
 * the time it was noticed the hour of version history Firestore keeps by
 * default had passed. The records could not be recovered and not even the
 * account that removed them could be named.
 *
 * So every delete now files a copy here first. It is written before the
 * document goes, by the same person, under the same rules — if the archive
 * write fails the delete does not happen, which is the right way round: a
 * record that cannot be copied is a record that must not be lost.
 *
 * Nothing reads this collection in the app. It is there for the day someone
 * asks "where did they go", and it answers with the whole document, who
 * deleted it, when, and from which screen.
 * ──────────────────────────────────────────────────────────────────── */

import type { User } from "firebase/auth";
import { addDoc, collection, doc, getDoc, serverTimestamp, type Firestore } from "firebase/firestore";
import { actorNameOf } from "./permissions";

export const STAFF_ARCHIVE_COLLECTION = "staff_deleted";

/** Which screen the delete was made from, so the press can be placed. */
export type StaffDeleteSource =
  | "new-employees-edit"
  | "staff-request-decline"
  | "active-employee";

/**
 * File a copy of `staff_onboarding/{uid}` before it is deleted.
 *
 * Reads the document itself rather than taking the screen's copy: the
 * screens hold a typed, trimmed version of the record, and what has to
 * survive is the whole of it. Returns false only when there was nothing
 * there to copy — which is not a reason to stop the delete.
 *
 * Throws if the copy cannot be written. Callers must let that stop them.
 */
export async function archiveStaffRecord(
  db: Firestore,
  uid: string,
  actor: User | null | undefined,
  source: StaffDeleteSource,
): Promise<boolean> {
  const snap = await getDoc(doc(db, "staff_onboarding", uid));
  if (!snap.exists()) return false;

  await addDoc(collection(db, STAFF_ARCHIVE_COLLECTION), {
    ...snap.data(),
    uid,
    deletedAt: serverTimestamp(),
    deletedByUid: actor?.uid ?? null,
    deletedByEmail: actor?.email ?? null,
    deletedByName: actorNameOf(actor),
    deletedFrom: source,
  });
  return true;
}
