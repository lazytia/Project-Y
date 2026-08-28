import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { FIRST_LOGIN_FIELD } from "@/lib/first-login";
import { TOTAL_ONBOARDING_STEPS } from "@/lib/onboarding-steps";
import { pushToOwners } from "@/lib/push-notify";
import { fullNameOf } from "@/lib/staff-display";

/**
 * Recording a new employee's first sign-in, and telling the owner about it.
 * Server-only — imports firebase-admin.
 */

const STAFF_COLLECTION = "staff_onboarding";

/**
 * Stamp the first sign-in, once, and return the employee's name if this call
 * was the one that recorded it.
 *
 * A transaction rather than a merge write because the session endpoint is
 * POSTed several times in the minutes after a sign-in: without the read the
 * stamp would keep moving forward, and the owner would be told again on every
 * one of them.
 *
 * Two cases are deliberately left alone:
 *
 * - No document. The employee's record is created by the owner before the
 *   account is handed over, so its absence means this uid is not somebody we
 *   can name — and writing one here would put a nameless row on the New
 *   Employees list.
 * - Onboarding already finished. Everyone hired before this field existed has
 *   no stamp either, and stamping them on their next sign-in would both
 *   record a falsehood and fire a burst of "first sign-in" alerts for staff
 *   the owner has known for months. Only somebody still working through the
 *   form is a first sign-in we can actually vouch for.
 */
async function stampFirstLogin(uid: string): Promise<string | null> {
  const ref = adminDb().collection(STAFF_COLLECTION).doc(uid);
  return adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const data = snap.data() ?? {};
    if (data[FIRST_LOGIN_FIELD]) return null;

    const completed = typeof data.completedStep === "number" ? data.completedStep : 0;
    if (completed >= TOTAL_ONBOARDING_STEPS) return null;

    tx.set(ref, { [FIRST_LOGIN_FIELD]: FieldValue.serverTimestamp() }, { merge: true });
    return fullNameOf(data);
  });
}

/**
 * Called on every verified sign-in. Does nothing at all for anyone who has
 * already been recorded, which is almost every call.
 *
 * Never throws: this is a side effect of signing in, and a Firestore hiccup
 * must not be what stops somebody getting into the app.
 */
export async function recordFirstLogin(uid: string): Promise<void> {
  try {
    const name = await stampFirstLogin(uid);
    if (!name) return;
    await pushToOwners({
      title: "New employee signed in",
      body: `${name} signed in for the first time.`,
      url: "/people/onboarding",
    });
  } catch {
    /* best-effort — see above */
  }
}
