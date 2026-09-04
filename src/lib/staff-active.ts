/** When an employee leaves onboarding and appears on /people/active. */

import { FIRST_LOGIN_FIELD } from "./first-login";
import { TOTAL_ONBOARDING_STEPS } from "./onboarding-steps";
import { CHEF_USERNAMES, OWNER_USERNAMES, STRICT_OWNER_USERNAMES } from "./permissions";
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
  /** Stamped by the session route the first time this account signs in. */
  firstLoginAt?: unknown;
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
  FIRST_LOGIN_FIELD,
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
    firstLoginAt: raw[FIRST_LOGIN_FIELD],
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

/**
 * The owners, the store manager and the chefs.
 *
 * Their staff_onboarding documents exist to hold a login and a pay rate, not
 * an onboarding form, so none of them is ever a new hire.
 *
 * The `role` field cannot answer this on its own. AuthProvider stamps "owner"
 * on the owner-tier accounts but leaves a chef as "chef", so the two shift
 * leads disagreed about themselves: Yurina was filtered out of New Employees
 * and Chuck — same standing, same length of service — sat on it as "Ready for
 * Review". Every other tier decision in the app is made from the username, so
 * this one is too, and the two of them answer alike.
 */
function isLeadershipAccount(raw: StaffOnboardingFlags): boolean {
  const username = (raw.username ?? emailToUsername(raw.email ?? "")).toLowerCase();
  return OWNER_USERNAMES.has(username) || CHEF_USERNAMES.has(username);
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
  if (isLeadershipAccount(raw)) return false;
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
export type OnboardingListStatus = "submitted" | "invited" | "started" | "ready";

/**
 * Has this person actually signed in and begun the form?
 *
 * `firstLoginAt` is the honest answer: the session route stamps it once, from
 * a verified ID token, so it records a sign-in that happened rather than an
 * account that was created. A saved step is accepted as the same proof — the
 * form is only reachable behind the login, so a step that exists is a sign-in
 * that happened — and it is the only proof there is for anyone who started
 * before the stamp was being written.
 */
export function hasStartedOnboarding(raw: StaffOnboardingFlags): boolean {
  return !!raw.firstLoginAt || (raw.completedStep ?? 0) > 0;
}

/**
 * Where this row stands, in the four states the list can show.
 *
 * `submitted` is a request nobody has approved yet. `invited` is an account
 * that has been created and texted out but never used. `started` is the new
 * hire having signed in and begun the form, and `ready` is that form finished
 * and waiting on the owner to sign it off.
 *
 * `invited` and `started` used to be one state, on the reasoning that issuing
 * a login is what puts somebody on the hook. It isn't: the owner creates the
 * account days before the person touches it, so the list said "Onboarding
 * Started" about people who had never opened the app, and the one thing the
 * owner comes here to find out — whether the new hire has got going — was the
 * one thing it could not tell her.
 *
 * `started` used to split in two the other way, with "In Progress" taking
 * over once the first step was saved. That split named a difference that
 * changed nothing: both halves are waiting on the same person to carry on. How
 * far in somebody is belongs on the review screen, which shows the steps
 * themselves rather than a word standing in for them.
 */
export function onboardingListStatus(raw: StaffOnboardingFlags): OnboardingListStatus {
  if (!isActiveEmployee(raw)) return "submitted";
  if ((raw.completedStep ?? 0) >= TOTAL_ONBOARDING_STEPS) return "ready";
  return hasStartedOnboarding(raw) ? "started" : "invited";
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
