/**
 * "+N" change badges for the sidebar menu.
 *
 * Notice Given and Ready to Terminate used to have their own rows on the
 * Active Employees attention card, which meant you only learned about them
 * by opening that one page. The signal now lives on the People menu itself:
 * each tracked list carries a badge counting how much it has grown since the
 * last time this user looked at it.
 *
 * The mark is a high-water mark, like the dashboard's "Noted" dismissal —
 * opening the page sets it to the current size, and it follows the list back
 * down when rows disappear so the next addition still reads as new.
 *
 * New Employees is the exception, and counts absolutely instead. Its badge is
 * the number of requests waiting on the owner to approve them, which is a
 * queue rather than news: it is not finished with by being read, so a mark
 * that cleared it the moment the page was opened cleared it while the work was
 * still outstanding. It goes away when the requests are approved.
 */

import type { User } from "firebase/auth";
import { collection, getDocs } from "firebase/firestore";
import { getDb } from "./firebase";
import { canViewStaffRequest } from "./permissions";
import {
  isOnboardingListEmployee,
  onboardingListStatus,
  staffOnboardingFlags,
} from "./staff-active";

/** Menu entries that carry a change badge, keyed by their nav href. */
export const NAV_BADGE_HREFS = {
  newEmployees: "/people/onboarding",
  noticeGiven: "/people/notice-given",
  terminated: "/people/terminated",
} as const;

/**
 * Entries whose badge is the count itself rather than the growth in it.
 *
 * These track work to be done, not arrivals to be noticed, so there is no
 * "seen" to keep for them and nothing about opening the page that settles it.
 */
export const ABSOLUTE_BADGE_HREFS: ReadonlySet<string> = new Set<string>([
  NAV_BADGE_HREFS.newEmployees,
]);

/** Sizes of each tracked list, keyed by href. */
export type NavCountMap = Record<string, number>;

const STORAGE_PREFIX = "y.navSeenCounts";

const TERMINATED_STATUS = "terminated";

function storageKey(uid: string): string {
  return `${STORAGE_PREFIX}.${uid}`;
}

export function readNavSeen(uid: string): NavCountMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey(uid));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: NavCountMap = {};
    for (const [href, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) out[href] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeNavSeen(uid: string, seen: NavCountMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(uid), JSON.stringify(seen));
  } catch {
    /* private mode / quota — the badge is a nicety, never a blocker */
  }
}

/**
 * How many rows arrived since this list was last seen.
 *
 * An unseen list returns 0 on purpose: the first sighting is what establishes
 * the baseline, otherwise every existing row would be announced as new the
 * first time the sidebar renders.
 */
export function navBadgeDelta(count: number, seen: number | undefined): number {
  if (seen === undefined) return 0;
  return Math.max(0, count - seen);
}

/** What this entry's badge should read: the queue itself, or what is new. */
export function navBadgeValue(href: string, count: number, seen: number | undefined): number {
  return ABSOLUTE_BADGE_HREFS.has(href) ? count : navBadgeDelta(count, seen);
}

/**
 * What the number means, said out loud.
 *
 * The two kinds of badge count different things and a screen reader has only
 * the number to go on, so the sentence has to carry the difference the "+"
 * cannot.
 */
export function navBadgeLabel(href: string, value: number): string {
  if (!ABSOLUTE_BADGE_HREFS.has(href)) return `${value} new since you last looked`;
  return `${value} request${value === 1 ? "" : "s"} awaiting approval`;
}

/**
 * Next marks to store, or null when the current ones already fit.
 *
 * Three reasons to move a mark: the list has never been seen (baseline it),
 * the user is looking at it right now (they have seen everything in it), or
 * the list shrank below the mark (follow it down, so a later addition is not
 * swallowed by a mark set when the list was longer).
 *
 * Absolute entries keep no mark at all — there is nothing for one to do, and
 * storing one would leave a stale number behind if the entry ever went back to
 * counting changes.
 */
export function reconcileNavSeen(
  counts: NavCountMap,
  seen: NavCountMap,
  visitedHref?: string,
): NavCountMap | null {
  const next = { ...seen };
  let changed = false;
  for (const [href, count] of Object.entries(counts)) {
    if (ABSOLUTE_BADGE_HREFS.has(href)) continue;
    const prev = next[href];
    const shouldFollow = prev === undefined || count < prev || href === visitedHref;
    if (shouldFollow && prev !== count) {
      next[href] = count;
      changed = true;
    }
  }
  return changed ? next : null;
}

type StaffStatusDoc = { status?: string };
type NoticeDoc = { employeeUid?: string };

/** The visibility fields; the list ones come from staffOnboardingFlags. */
type RequesterDoc = {
  requestedByRole?: string;
  requestedByName?: string;
};

/**
 * What each tracked entry's badge is counting.
 *
 * Notice Given and Ready to Terminate are the size of the page they point at
 * — a badge that counted differently to the list it opens would never clear.
 * New Employees counts only the rows still waiting on an approval, because
 * that is the badge's whole subject: the rest of that page is people already
 * approved and working through their forms, and nothing about them is owed.
 *
 * `viewer` is needed because New Employees is not the same list for everyone:
 * the chef sees only his own requests and the manager only hers, so a count
 * taken over the whole collection would leave a badge nobody could clear by
 * approving what they can see.
 */
export async function loadNavBadgeCounts(viewer: User | null | undefined): Promise<NavCountMap> {
  const db = getDb();
  const [noticeSnap, staffSnap] = await Promise.all([
    getDocs(collection(db, "notice_given")),
    getDocs(collection(db, "staff_onboarding")),
  ]);

  const terminatedUids = new Set(
    staffSnap.docs
      .filter((d) => ((d.data() as StaffStatusDoc).status ?? "").toLowerCase() === TERMINATED_STATUS)
      .map((d) => d.id),
  );

  const pendingApproval = staffSnap.docs.filter((d) => {
    const raw = d.data() as Record<string, unknown>;
    const flags = staffOnboardingFlags(raw);
    return (
      isOnboardingListEmployee(flags) &&
      onboardingListStatus(flags) === "submitted" &&
      canViewStaffRequest(viewer, raw as RequesterDoc)
    );
  }).length;

  // Notices for someone already terminated drop off that page, so they must
  // not count here either.
  const noticeGiven = noticeSnap.docs.filter((d) => {
    const uid = (d.data() as NoticeDoc).employeeUid;
    return !!uid && !terminatedUids.has(uid);
  }).length;

  return {
    [NAV_BADGE_HREFS.newEmployees]: pendingApproval,
    [NAV_BADGE_HREFS.noticeGiven]: noticeGiven,
    [NAV_BADGE_HREFS.terminated]: terminatedUids.size,
  };
}
