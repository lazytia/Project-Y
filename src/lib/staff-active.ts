/** When an employee leaves onboarding and appears on /people/active. */

export type StaffOnboardingFlags = {
  status?: string;
  role?: string;
  accountCreated?: boolean;
  addedToScheduling?: boolean;
  approvedAt?: unknown;
  username?: string;
  email?: string;
};

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

export function isOnboardingListEmployee(raw: StaffOnboardingFlags): boolean {
  if (raw.role === "owner") return false;
  if ((raw.status ?? "").toLowerCase() === "terminated") return false;
  return !isActiveEmployee(raw);
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
