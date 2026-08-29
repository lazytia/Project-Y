/** When an employee leaves onboarding and appears on /people/active. */

import { TOTAL_ONBOARDING_STEPS } from "./onboarding-steps";
import { STRICT_OWNER_USERNAMES } from "./permissions";
import { emailToUsername } from "./username";

export type StaffOnboardingFlags = {
  status?: string;
  role?: string;
  accountCreated?: boolean;
  addedToScheduling?: boolean;
  approvedAt?: unknown;
  username?: string;
  email?: string;
  /** Stamped when the owner signs the onboarding off — see below. */
  activatedAt?: unknown;
  /** How far through the onboarding form the employee has got. */
  completedStep?: number;
};

/**
 * The staff_onboarding fields `staffOnboardingFlags` reads.
 *
 * Exported so a server query can project just these and still get an honest
 * answer. A staff document carries signature PNGs and document URLs, and a
 * page that only needs to know who is on the roster should not be paying to
 * download them. Add a field above and it has to be added here too, or the
 * projected read will quietly answer as though it were absent.
 */
export const STAFF_FLAG_FIELDS = [
  "status",
  "role",
  "accountCreated",
  "addedToScheduling",
  "approvedAt",
  "username",
  "email",
  "activatedAt",
  "completedStep",
] as const;

/**
 * Pull the flags out of a raw staff_onboarding document.
 *
 * Four screens ask these predicates the same question, and each used to
 * hand-copy the field list on the way in. That is fine until the list grows:
 * the copy that was missed doesn't fail, it quietly answers as though the new
 * field were absent, and the badge count stops matching the page it counts.
 */
export function staffOnboardingFlags(raw: Record<string, unknown>): StaffOnboardingFlags {
  return {
    status: typeof raw.status === "string" ? raw.status : undefined,
    role: typeof raw.role === "string" ? raw.role : undefined,
    accountCreated: raw.accountCreated === true,
    addedToScheduling: raw.addedToScheduling === true,
    approvedAt: raw.approvedAt,
    username: typeof raw.username === "string" ? raw.username : undefined,
    email: typeof raw.email === "string" ? raw.email : undefined,
    activatedAt: raw.activatedAt,
    completedStep: typeof raw.completedStep === "number" ? raw.completedStep : undefined,
  };
}

/**
 * Everyone on the roster except the real business owners (Tia, Yurica, Eddie)
 * and anyone who has been terminated.
 *
 * Managers, chefs, staff mid-onboarding and staff who have not started yet all
 * count — this is "the team", the population a roster or a document chase is
 * measured against. AuthProvider stamps every account with role="owner" when
 * it has owner-level UI access, so filtering on the role would also drop the
 * managers; the username is what tells the two apart.
 *
 * Pair it with `isActiveEmployee` for the list of people who actually have a
 * login today.
 */
export function isTeamMember(raw: StaffOnboardingFlags): boolean {
  if ((raw.status ?? "").toLowerCase() === "terminated") return false;
  const username = (raw.username ?? emailToUsername(raw.email ?? "")).toLowerCase();
  return !STRICT_OWNER_USERNAMES.has(username);
}

/** Matches the owner-approval rule used on /people/onboarding. */
export function isOwnerApproved(raw: StaffOnboardingFlags): boolean {
  const status = (raw.status ?? "").toLowerCase();
  return status === "approved" || status === "active" || !!raw.approvedAt || !!raw.accountCreated;
}

export function isActiveEmployee(raw: StaffOnboardingFlags): boolean {
  const status = (raw.status ?? "").toLowerCase();
  if (status === "terminated") return false;
  if (isOwnerApproved(raw)) return true;

  // Legacy hires stored before approval flags — keep anyone with a login
  // who is not still a pending manager request.
  const pending = status === "waiting for documents";
  const hasLogin = !!(raw.username?.trim() || raw.email?.trim());
  return hasLogin && !pending;
}

/** Has the owner signed this employee's onboarding off? */
export function isActivated(raw: StaffOnboardingFlags): boolean {
  return !!raw.activatedAt;
}

/**
 * Who belongs on New Employees.
 *
 * The list used to be "everyone who is not active yet", and active began the
 * moment a login was issued — which is *before* the employee has filled in a
 * single step, because the login is how they reach the form. So the people
 * whose onboarding actually needed watching fell off this list on the day
 * they were created, and the owner had to chase their documents from Active
 * Employees instead. They stay here now until the onboarding is signed off.
 *
 * Sign-off is `activatedAt`, and rows that never had an onboarding form —
 * everyone hired before it existed — carry no `completedStep`. Those are the
 * established team and must not resurface as new hires, so a missing marker
 * counts as done. Anyone else with a login is still working through the form,
 * or has finished it and is waiting to be reviewed.
 *
 * Nobody is taken off Active Employees by this: that list still keys on
 * having a login, so an employee mid-onboarding appears on both, which is
 * what they are — employed, and not finished.
 */
export function isOnboardingListEmployee(raw: StaffOnboardingFlags): boolean {
  if (raw.role === "owner") return false;
  if ((raw.status ?? "").toLowerCase() === "terminated") return false;
  if (isActivated(raw)) return false;
  if (!isActiveEmployee(raw)) return true;
  return typeof raw.completedStep === "number";
}

/**
 * Onboarding is finished and the owner has not signed it off — the
 * "Ready for Review" half of the list. Everyone else on it is "New".
 */
export function isReadyForReview(raw: StaffOnboardingFlags): boolean {
  if (!isOnboardingListEmployee(raw)) return false;
  return (raw.completedStep ?? 0) >= TOTAL_ONBOARDING_STEPS;
}

/** How far along a New Employees row is, for its status pill. */
export type OnboardingListStatus = "submitted" | "started" | "in_progress" | "ready";

/**
 * Where this row stands, in the four states the list can show.
 *
 * The three "New" states are not decoration — they say who is holding things
 * up, which is the question the list is opened to answer. `submitted` is
 * waiting on the owner to approve the request; `started` and `in_progress`
 * are waiting on the employee; `ready` is waiting on the owner again.
 *
 * `started` and `in_progress` are told apart by `completedStep`, which
 * `createStaffAccount` seeds at 0 the moment the login is issued — so a row
 * sitting at 0 has been given the form and not opened it, rather than being
 * a row from before the form existed. Those legacy rows carry no marker at
 * all and are kept off this list entirely by isOnboardingListEmployee.
 */
export function onboardingListStatus(raw: StaffOnboardingFlags): OnboardingListStatus {
  if (!isActiveEmployee(raw)) return "submitted";
  const step = raw.completedStep ?? 0;
  if (step >= TOTAL_ONBOARDING_STEPS) return "ready";
  return step > 0 ? "in_progress" : "started";
}

export function staffStatusAfterOnboardingSteps(accountCreated: boolean): "active" | "approved" {
  return accountCreated ? "active" : "approved";
}

/** Merge scheduling / approval progress and derive the next status. */
export function onboardingProgressPatch(
  current: StaffOnboardingFlags,
  update: { accountCreated?: boolean; addedToScheduling?: boolean },
): { accountCreated: boolean; addedToScheduling: boolean; status: "active" | "approved" } {
  const accountCreated = update.accountCreated ?? !!current.accountCreated;
  const addedToScheduling = update.addedToScheduling ?? !!current.addedToScheduling;
  return {
    accountCreated,
    addedToScheduling,
    status: staffStatusAfterOnboardingSteps(accountCreated),
  };
}
