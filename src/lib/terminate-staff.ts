/* ──────────────────────────────────────────────────────────────────────
 * Ending someone's employment, from whichever screen does it.
 *
 * Two screens terminate — the employee's own page and the notice they gave —
 * and a termination is three things, not one: the record moves to Terminated,
 * the notice that was counting down to it is cleared away, and the login
 * stops working. Written once so the two screens cannot drift into doing two
 * and a half of them.
 * ──────────────────────────────────────────────────────────────────── */

import type { User } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Firestore,
} from "firebase/firestore";

/** What the notice said, where one was given. All of it is optional. */
export type TerminationNotice = {
  noticeGivenDate?: string;
  reasonForLeaving?: string;
  reasonForLeavingOther?: string;
  rehireEligible?: string;
  managerNotes?: string;
};

/** The name to record against the act, as the app's other screens write it. */
export function actorDisplayName(user: User | null | undefined): string {
  return (
    user?.displayName?.trim() || (user?.email ? user.email.split("@")[0] : "Owner")
  );
}

/**
 * Switch an employee's login off, or back on.
 *
 * Server-side work — only the Admin SDK can disable an account — so it goes
 * through /api/staff/login-access with the caller's own token.
 */
export async function setStaffLoginEnabled(
  user: User | null | undefined,
  uid: string,
  enabled: boolean,
): Promise<void> {
  if (!user) throw new Error("Not signed in.");
  const idToken = await user.getIdToken();
  const res = await fetch("/api/staff/login-access", {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ uid, disabled: !enabled }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error ?? `Could not change the login (${res.status}).`);
}

/**
 * Terminate an employee.
 *
 * The login goes first on purpose. If that call fails nothing has happened
 * yet and the screen can say so; the other order would leave somebody filed
 * as gone with a working login and nothing on screen to show it.
 */
export async function terminateStaff(input: {
  db: Firestore;
  uid: string;
  lastWorkingDayISO: string;
  notice?: TerminationNotice | null;
  actor: User | null | undefined;
}): Promise<void> {
  const { db, uid, lastWorkingDayISO, notice, actor } = input;

  await setStaffLoginEnabled(actor, uid, false);

  const reasonBase = notice?.reasonForLeaving ?? "";
  const reasonOther = notice?.reasonForLeavingOther ?? "";
  const reasonDisplay =
    reasonBase === "Other" && reasonOther.trim() ? `Other — ${reasonOther.trim()}` : reasonBase;

  await setDoc(
    doc(db, "staff_onboarding", uid),
    {
      status: "terminated",
      terminatedAt: serverTimestamp(),
      lastWorkingDate: lastWorkingDayISO,
      reasonForLeaving: reasonBase,
      reasonForLeavingOther: reasonBase === "Other" ? reasonOther.trim() : "",
      terminationReason: reasonDisplay,
      noticeGivenDate: notice?.noticeGivenDate ?? "",
      rehireEligible: notice?.rehireEligible ?? "",
      terminationManagerNotes: notice?.managerNotes ?? "",
      terminatedByName: actorDisplayName(actor),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  // The notice was a countdown to this day. Leaving it behind would keep the
  // Notice Given list counting down to a day that has already come.
  const open = await getDocs(query(collection(db, "notice_given"), where("employeeUid", "==", uid)));
  await Promise.all(open.docs.map((d) => deleteDoc(d.ref)));
}
