import type { User } from "firebase/auth";
import { emailToUsername } from "./username";

/**
 * Usernames with owner-level access (full admin/manager rights).
 * Add a username here to grant access to owner-only pages.
 */
export const OWNER_USERNAMES: ReadonlySet<string> = new Set(["tia", "yurica"]);

/** True if the given user has owner-level permissions. */
export function isOwner(user: User | null | undefined): boolean {
  if (!user) return false;
  return OWNER_USERNAMES.has(emailToUsername(user.email).toLowerCase());
}
