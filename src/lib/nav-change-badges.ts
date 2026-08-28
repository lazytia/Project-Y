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
 */

import type { User } from "firebase/auth";
import { collection, getDocs } from "firebase/firestore";
import { getDb } from "./firebase";
import { canViewStaffRequest } from "./permissions";
import { isOnboardingListEmployee, staffOnboardingFlags } from "./staff-active";

/** Menu entries that carry a change badge, keyed by their nav href. */
export const NAV_BADGE_HREFS = {
  newEmployees: "/people/onboarding",
  noticeGiven: "/people/notice-given",
  terminated: "/people/terminated",
} as const;

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

/**
 * Next marks to store, or null when the current ones already fit.
 *
 * Three reasons to move a mark: the list has never been seen (baseline it),
 * the user is looking at it right now (they have seen everything in it), or
 * the list shrank below the mark (follow it down, so a later addition is not
 * swallowed by a mark set when the list was longer).
 */
export function reconcileNavSeen(
  counts: NavCountMap,
  seen: NavCountMap,
  visitedHref?: string,
): NavCountMap | null {
  const next = { ...seen };
  let changed = false;
  for (const [href, count] of Object.entries(counts)) {
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
 * Current size of each tracked list.
 *
 * Deliberately mirrors what /people/onboarding, /people/notice-given and
 * /people/terminated themselves show — a badge that counts differently to the
 * page it points at would never clear.
 *
 * `viewer` is needed because New Employees is not the same list for everyone:
 * the chef sees only his own requests and the manager only hers, so a count
 * taken over the whole collection would leave a badge nobody could clear by
 * opening the page.
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

  const newEmployees = staffSnap.docs.filter((d) => {
    const raw = d.data() as Record<string, unknown>;
    return (
      isOnboardingListEmployee(staffOnboardingFlags(raw)) &&
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
    [NAV_BADGE_HREFS.newEmployees]: newEmployees,
    [NAV_BADGE_HREFS.noticeGiven]: noticeGiven,
    [NAV_BADGE_HREFS.terminated]: terminatedUids.size,
  };
}
