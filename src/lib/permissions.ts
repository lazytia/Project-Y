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

/** True if the given user has owner-level permissions. */
export function isOwner(user: User | null | undefined): boolean {
  if (!user) return false;
  return OWNER_USERNAMES.has(emailToUsername(user.email).toLowerCase());
}
