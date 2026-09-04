/**
 * "+N" change badges for the sidebar menu.
 *
 * Notice Given and Ready to Terminate used to have their own rows on the
 * Active Employees attention card, which meant you only learned about them
 * by opening that one page. The signal now lives on the People menu itself:
 * each tracked list carries a badge for what has changed about it since the
 * last time this user looked.
 *
 * Two of the three measure that by size. The mark is a high-water mark, like
 * the dashboard's "Noted" dismissal — opening the page sets it to the current
 * size, and it follows the list back down when rows disappear so the next
 * addition still reads as new.
 *
 * New Employees cannot, because the thing worth announcing about it happens
 * without the size changing: a new hire signing in and starting the form, or
 * finishing it, moves a row between stages and leaves the count where it was.
 * A size mark had nothing to notice, so the badge said nothing on the two
 * occasions the owner most wanted telling. It keeps the stage of each row
 * instead, and counts the rows standing somewhere other than where she left
 * them — which covers an arrival too, a row she has never seen being a row
 * that has moved.
 */

import type { User } from "firebase/auth";
import { collection, getDocs } from "firebase/firestore";
import { getDb } from "./firebase";
import { canViewStaffRequest } from "./permissions";
import {
  isOnboardingListEmployee,
  onboardingListStatus,
  staffOnboardingFlags,
  type OnboardingListStatus,
} from "./staff-active";

/** Menu entries that carry a change badge, keyed by their nav href. */
export const NAV_BADGE_HREFS = {
  newEmployees: "/people/onboarding",
  noticeGiven: "/people/notice-given",
  terminated: "/people/terminated",
} as const;

/** Sizes of the size-tracked lists, keyed by href. */
export type NavCountMap = Record<string, number>;

/** What stage each new hire was standing at, keyed by their uid. */
export type OnboardingStageMap = Record<string, OnboardingListStatus>;

/** Everything the badges are computed from, read in one pass. */
export type NavBadgeSnapshot = {
  counts: NavCountMap;
  onboarding: OnboardingStageMap;
};

const STORAGE_PREFIX = "y.navSeenCounts";
const ONBOARDING_STORAGE_PREFIX = "y.navSeenOnboarding";

const TERMINATED_STATUS = "terminated";

function storageKey(uid: string): string {
  return `${STORAGE_PREFIX}.${uid}`;
}

function onboardingStorageKey(uid: string): string {
  return `${ONBOARDING_STORAGE_PREFIX}.${uid}`;
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
 * The stages this user last saw, or undefined if they never have.
 *
 * The distinction matters here in a way it does not for the counts: an empty
 * object is a list this user has looked at and found empty, which is a real
 * baseline, while a missing key is a browser that has never rendered the
 * sidebar. Returning `{}` for both would announce the whole list at once the
 * first time.
 */
export function readOnboardingSeen(uid: string): OnboardingStageMap | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(onboardingStorageKey(uid));
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return undefined;
    const out: OnboardingStageMap = {};
    for (const [rowUid, stage] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof stage === "string") out[rowUid] = stage as OnboardingListStatus;
    }
    return out;
  } catch {
    return undefined;
  }
}

export function writeOnboardingSeen(uid: string, seen: OnboardingStageMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(onboardingStorageKey(uid), JSON.stringify(seen));
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
 * How many new hires are standing somewhere other than where they were left.
 *
 * A uid with no recorded stage counts, and so does every uid when nothing has
 * been recorded at all: an arrival is a move from nowhere, and saying so keeps
 * this to one rule instead of a rule and an exception.
 *
 * Which is why there is no baseline sighting here, unlike the counts above.
 * A list of new hires is not a backdrop the badge should quietly agree to —
 * every row on it is somebody nobody has finished with, so a browser seeing
 * the list for the first time is being told about it for the first time. The
 * mark is set by opening the page, not by rendering the menu beside it.
 *
 * Rows that have left the list are ignored: an activated employee is not
 * news, they are gone.
 */
export function onboardingBadgeDelta(
  live: OnboardingStageMap,
  seen: OnboardingStageMap | undefined,
): number {
  let moved = 0;
  for (const [uid, stage] of Object.entries(live)) {
    if (seen?.[uid] !== stage) moved += 1;
  }
  return moved;
}

/**
 * What the number means, said out loud.
 *
 * A screen reader has only the number to go on, and New Employees counts
 * something the other two do not — movement rather than arrivals — so the
 * sentence has to carry the difference the "+" cannot.
 */
export function navBadgeLabel(href: string, value: number): string {
  if (href !== NAV_BADGE_HREFS.newEmployees) return `${value} new since you last looked`;
  return `${value} new employee${value === 1 ? "" : "s"} arrived or moved on since you last looked`;
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

/**
 * The stage mark to store next, or null when the stored one already fits.
 *
 * Two reasons to move it, one fewer than above. Opening the page adopts every
 * stage on screen — the owner has just looked at all of them. And rows that
 * have left the list are dropped, which is this map's version of following a
 * shrinking list down: a uid kept after its row was activated would come back
 * as a stale "moved" if that person were ever re-onboarded.
 *
 * Merely rendering the sidebar is not a reason, which is the difference from
 * the counts: a mark written on sight would settle the badge in the same tick
 * it was raised, and the owner would watch a "+1" appear and vanish. This mark
 * is only ever written by her actually going and looking.
 */
export function reconcileOnboardingSeen(
  live: OnboardingStageMap,
  seen: OnboardingStageMap | undefined,
  visiting: boolean,
): OnboardingStageMap | null {
  if (visiting) {
    const next = { ...live };
    return seen && sameStages(seen, next) ? null : next;
  }
  if (!seen) return null;
  const next: OnboardingStageMap = {};
  for (const [uid, stage] of Object.entries(seen)) {
    if (uid in live) next[uid] = stage;
  }
  return sameStages(seen, next) ? null : next;
}

function sameStages(a: OnboardingStageMap, b: OnboardingStageMap): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => a[k] === b[k]);
}

type StaffStatusDoc = { status?: string };
type NoticeDoc = { employeeUid?: string };

/** The visibility fields; the list ones come from staffOnboardingFlags. */
type RequesterDoc = {
  requestedByRole?: string;
  requestedByName?: string;
};

/**
 * What each tracked entry's badge is measuring.
 *
 * The two size-tracked entries are the size of the page they point at — a
 * badge that counted differently to the list it opens would never clear. New
 * Employees is the same list, recorded row by row so that a stage change
 * inside it is visible; what is done with that is decided above.
 *
 * `viewer` is needed because New Employees is not the same list for everyone:
 * the chef sees only his own requests and the manager only hers, so a badge
 * taken over the whole collection would be one nobody could clear by working
 * through what they can see.
 */
export async function loadNavBadgeSnapshot(
  viewer: User | null | undefined,
): Promise<NavBadgeSnapshot> {
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

  const onboarding: OnboardingStageMap = {};
  for (const d of staffSnap.docs) {
    const raw = d.data() as Record<string, unknown>;
    const flags = staffOnboardingFlags(raw);
    if (!isOnboardingListEmployee(flags)) continue;
    if (!canViewStaffRequest(viewer, raw as RequesterDoc)) continue;
    onboarding[d.id] = onboardingListStatus(flags);
  }

  // Notices for someone already terminated drop off that page, so they must
  // not count here either.
  const noticeGiven = noticeSnap.docs.filter((d) => {
    const uid = (d.data() as NoticeDoc).employeeUid;
    return !!uid && !terminatedUids.has(uid);
  }).length;

  return {
    counts: {
      [NAV_BADGE_HREFS.noticeGiven]: noticeGiven,
      [NAV_BADGE_HREFS.terminated]: terminatedUids.size,
    },
    onboarding,
  };
}
