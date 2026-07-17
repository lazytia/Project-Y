import type { User } from "firebase/auth";
import { emailToUsername } from "./username";

/**
 * Usernames with owner-level access (full admin/manager rights).
 * Add a username here to grant access to owner-only pages.
 *
 * "yurina" is a manager — for now she gets the same UI/permissions as the
 * real owners. Will be split into a separate "manager" tier later.
 */
export const OWNER_USERNAMES: ReadonlySet<string> = new Set(["tia", "yurica", "yurina", "eddie"]);

/**
 * Strict-owner accounts (real business owners). Managers like yurina are
 * inside OWNER_USERNAMES so they get owner-level routing and UI, but a few
 * sensitive areas (Staff +, Onboarding management, Payroll, Test) should
 * still be hidden from them. Use this set for those gates.
 */
export const STRICT_OWNER_USERNAMES: ReadonlySet<string> = new Set(["tia", "yurica", "eddie"]);

/**
 * Chef accounts — kitchen leadership with their own dashboard.
 * Chefs see a dedicated Chef Dashboard instead of the regular staff page.
 */
export const CHEF_USERNAMES: ReadonlySet<string> = new Set(["chinglam", "chuck"]);

/** True if the given user has owner-level permissions (owner or manager). */
export function isOwner(user: User | null | undefined): boolean {
  if (!user) return false;
  return OWNER_USERNAMES.has(emailToUsername(user.email).toLowerCase());
}

/** True only for the real business owners (excludes managers). */
export function isStrictOwner(user: User | null | undefined): boolean {
  if (!user) return false;
  return STRICT_OWNER_USERNAMES.has(emailToUsername(user.email).toLowerCase());
}

/** True if the given user is a chef. */
export function isChef(user: User | null | undefined): boolean {
  if (!user) return false;
  return CHEF_USERNAMES.has(emailToUsername(user.email).toLowerCase());
}

/** Owner, manager, or chef — people-management UI (excludes strict-owner-only areas). */
export function isOwnerOrChef(user: User | null | undefined): boolean {
  return isOwner(user) || isChef(user);
}

/** Server-side strict-owner check from a Firebase Auth email claim. */
export function isStrictOwnerEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return STRICT_OWNER_USERNAMES.has(emailToUsername(email).toLowerCase());
}

/** Store manager (yurina) — owner UI tier but not a strict business owner. */
export function isManager(user: User | null | undefined): boolean {
  return isOwner(user) && !isStrictOwner(user) && !isChef(user);
}

export type RequestSubmitterRole = "chef" | "manager" | "owner";

/** Role stamped on a New Staff Request when it is created. */
export function submitterRoleForUser(user: User | null | undefined): RequestSubmitterRole {
  if (isChef(user)) return "chef";
  if (isStrictOwner(user)) return "owner";
  if (isOwner(user)) return "manager";
  return "manager";
}

type StaffRequestVisibility = {
  requestedByRole?: string;
  requestedByName?: string;
};

/** Infer submitter role for legacy docs missing requestedByRole. */
export function inferRequestSubmitterRole(request: StaffRequestVisibility): RequestSubmitterRole {
  const stored = request.requestedByRole;
  if (stored === "chef" || stored === "manager" || stored === "owner") return stored;
  const name = (request.requestedByName ?? "").trim().toLowerCase();
  for (const chef of CHEF_USERNAMES) {
    if (name === chef) return "chef";
  }
  if (STRICT_OWNER_USERNAMES.has(name)) return "owner";
  return "manager";
}

/**
 * Chef-submitted requests → chef + strict owners.
 * Manager-submitted requests → manager + strict owners.
 * Owner-submitted requests → strict owners only.
 */
export function canViewStaffRequest(
  viewer: User | null | undefined,
  request: StaffRequestVisibility,
): boolean {
  if (!viewer) return false;
  if (isStrictOwner(viewer)) return true;
  const submitterRole = inferRequestSubmitterRole(request);
  if (isChef(viewer)) return submitterRole === "chef";
  if (isManager(viewer)) return submitterRole === "manager";
  return false;
}
