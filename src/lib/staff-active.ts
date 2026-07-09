/** When an employee leaves onboarding and appears on /people/active. */

export type StaffOnboardingFlags = {
  status?: string;
  role?: string;
  accountCreated?: boolean;
  addedToScheduling?: boolean;
};

export function isActiveEmployee(raw: StaffOnboardingFlags): boolean {
  const status = (raw.status ?? "").toLowerCase();
  if (status === "terminated") return false;
  if (status === "active") return true;
  return !!(raw.accountCreated && raw.addedToScheduling);
}

export function isOnboardingListEmployee(raw: StaffOnboardingFlags): boolean {
  if (raw.role === "owner") return false;
  if ((raw.status ?? "").toLowerCase() === "terminated") return false;
  return !isActiveEmployee(raw);
}

export function staffStatusAfterOnboardingSteps(
  accountCreated: boolean,
  addedToScheduling: boolean,
): "active" | "approved" {
  return accountCreated && addedToScheduling ? "active" : "approved";
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
    status: staffStatusAfterOnboardingSteps(accountCreated, addedToScheduling),
  };
}
