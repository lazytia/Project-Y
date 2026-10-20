import { arrayUnion, doc, setDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";

/* ──────────────────────────────────────────────────────────────────────
 * A notice that has been opened is finished with.
 *
 * Needs Your Attention on the staff dashboard lists what has been announced
 * to an employee — a holiday or availability decision, a published roster.
 * A decision is read once, and after that the row was only telling them what
 * they already knew; with nothing to clear it, it sat on the dashboard for
 * good and tapping it changed nothing.
 *
 * So opening a notice's page records its id here, and the dashboard stops
 * listing it. The bell inbox is the history and keeps every notice either
 * way. A published roster also clears by the week being opened (see
 * lib/roster-seen), which covers opening the roster itself rather than the
 * notice; this covers every kind by the notice being opened.
 * ──────────────────────────────────────────────────────────────────── */

/** Array field on staff_onboarding/{uid}: ids of the notifications opened. */
export const NOTIFICATIONS_SEEN_FIELD = "notificationsSeen";

/** The ids recorded on a staff_onboarding document, whatever shape it holds. */
export function seenNotificationIds(data: Record<string, unknown>): ReadonlySet<string> {
  const raw = data[NOTIFICATIONS_SEEN_FIELD];
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((id): id is string => typeof id === "string"));
}

/**
 * Record that this employee has opened a notification.
 *
 * Best-effort, like markRosterWeekSeen: a failed write only means the row stays
 * on the dashboard, which is where it already was, so it is never worth an
 * error in front of someone who just wanted to read the notice. arrayUnion
 * rather than a read-then-write, so two notices opened close together cannot
 * overwrite each other's id.
 */
export async function markNotificationSeen(uid: string, notificationId: string): Promise<void> {
  if (!uid || !notificationId) return;
  try {
    await setDoc(
      doc(getDb(), "staff_onboarding", uid),
      { [NOTIFICATIONS_SEEN_FIELD]: arrayUnion(notificationId) },
      { merge: true },
    );
  } catch {
    // See above.
  }
}
