import type { User } from "firebase/auth";
import { emailToUsername } from "./username";

/**
 * Usernames with owner-level access (full admin/manager rights).
 * Add a username here to grant access to owner-only pages.
 *
 * "yurina" is a manager — for now she gets the same UI/permissions as the
 * real owners. Will be split into a separate "manager" tier later.
 */
export const OWNER_USERNAMES: ReadonlySet<string> = new Set(["tia", "yurica", "yurina"]);

/**
 * Strict-owner accounts (real business owners). Managers like yurina are
 * inside OWNER_USERNAMES so they get owner-level routing and UI, but a few
 * sensitive areas (Staff +, Onboarding management, Payroll, Test) should
 * still be hidden from them. Use this set for those gates.
 */
export const STRICT_OWNER_USERNAMES: ReadonlySet<string> = new Set(["tia", "yurica"]);

/**
 * Chef accounts — kitchen leadership with their own dashboard.
 * Chefs see a dedicated Chef Dashboard instead of the regular staff page.
 */
export const CHEF_USERNAMES: ReadonlySet<string> = new Set(["chinglam"]);

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
