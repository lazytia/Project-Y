import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";

/* ──────────────────────────────────────────────────────────────────────
 * "Roster published" is news, not a task.
 *
 * Every other row in Needs Your Attention is owed something — a signature,
 * a decision to read. This one is owed a look at the roster, and once that
 * look has happened the row is telling the employee about a week they have
 * already seen. So it clears itself rather than waiting to be dismissed,
 * the same way signing the beer guide is what removes the beer guide row.
 *
 * Seen-ness is recorded per week, not as one "you opened the roster at"
 * timestamp. The roster page opens on the current week while the roster
 * being announced is usually the next one, so a single timestamp would
 * clear next week's notice the moment someone glanced at this week's.
 * ──────────────────────────────────────────────────────────────────── */

/** `kind` that publishStaffRoster() writes on the notification it appends. */
export const ROSTER_PUBLISHED_KIND = "roster-published";

/** Map field on staff_onboarding/{uid}: weekStartISO → when it was opened. */
export const ROSTER_SEEN_FIELD = "rosterSeenAt";

/** Raw `rosterSeenAt` map as it comes back from Firestore. */
export type RosterSeenMap = Record<string, unknown>;

/** Minimal shape this module needs off a stored notification. */
export type RosterAnnouncement = {
  kind?: string;
  createdAt?: unknown;
  weekStartISO?: string;
};

function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object" && v !== null) {
    if (typeof (v as { toDate?: unknown }).toDate === "function") {
      try {
        return (v as { toDate: () => Date }).toDate();
      } catch {
        return null;
      }
    }
    // Plain {seconds, nanoseconds} — a Timestamp that went through JSON.
    const o = v as { seconds?: unknown };
    if (typeof o.seconds === "number") return new Date(o.seconds * 1000);
  }
  return null;
}

/**
 * Record that this employee has looked at a given week of the roster.
 *
 * Best-effort: a failed write only means the notice stays up, which is the
 * state the screen was already in, so it is never worth an error in front
 * of someone who just wanted to read their shifts.
 */
export async function markRosterWeekSeen(
  uid: string,
  weekStartISO: string,
): Promise<void> {
  if (!uid || !weekStartISO) return;
  try {
    await setDoc(
      doc(getDb(), "staff_onboarding", uid),
      { [ROSTER_SEEN_FIELD]: { [weekStartISO]: serverTimestamp() } },
      { merge: true },
    );
  } catch {
    // See above.
  }
}

/** The most recent week-opened timestamp, for notices that predate the field. */
function latestSeen(seen: RosterSeenMap): Date | null {
  let newest: Date | null = null;
  for (const v of Object.values(seen)) {
    const d = toDate(v);
    if (d && (!newest || d.getTime() > newest.getTime())) newest = d;
  }
  return newest;
}

/**
 * True once the week a "Roster published" notice announces has been opened.
 *
 * Anything that is not a roster notice is never hidden by this — holiday and
 * availability decisions are read and kept, and the bell inbox keeps the
 * full history of all of them either way.
 */
export function isRosterAnnouncementSeen(
  n: RosterAnnouncement,
  seen: RosterSeenMap,
): boolean {
  if (n.kind !== ROSTER_PUBLISHED_KIND) return false;
  // Notices written before this field existed carry no week; fall back to
  // "has the roster been opened at all since this was posted".
  const seenAt = n.weekStartISO ? toDate(seen[n.weekStartISO]) : latestSeen(seen);
  if (!seenAt) return false;
  const createdAt = toDate(n.createdAt);
  // No timestamp to compare against — having opened the week is enough.
  if (!createdAt) return true;
  return seenAt.getTime() >= createdAt.getTime();
}
