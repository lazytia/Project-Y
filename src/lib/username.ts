// Internal domain used to convert usernames into Firebase Auth emails.
// Users never see this — it exists only so Firebase Auth's email/password
// provider can store accounts that the user thinks of as "username + password".
const INTERNAL_DOMAIN = "projecty.local";

// Login IDs are case-insensitive: the owner can type "Test Yurica"
// on the approve screen, but everything downstream (Firebase Auth
// email, Firestore username field, permission checks) uses the lower-
// cased form. That way logging in with "test", "Test", or "TEST" all
// resolve to the same account.
const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,30}$/;

export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${INTERNAL_DOMAIN}`;
}

/** True for the made-up address an account signs in with, not a mailbox. */
export function isLoginEmail(email: string | null | undefined): boolean {
  return !!email && email.trim().toLowerCase().endsWith(`@${INTERNAL_DOMAIN}`);
}

/**
 * The employee's own email address, as they gave it in onboarding.
 *
 * Kept in `personalEmail`, apart from `email`: that field on a staff record is
 * the login address the approve flow writes (username@projecty.local), and
 * the personal information form used to prefill itself from it — so nobody
 * ever typed a real address and the owners were shown the login one. Older
 * records that only have `email` still count when it is a real address.
 */
export function personalEmailOf(raw: Record<string, unknown>): string {
  const own = typeof raw.personalEmail === "string" ? raw.personalEmail.trim() : "";
  if (own) return own;
  const legacy = typeof raw.email === "string" ? raw.email.trim() : "";
  return legacy && !isLoginEmail(legacy) ? legacy : "";
}

export function emailToUsername(email: string | null | undefined): string {
  if (!email) return "";
  const at = email.indexOf("@");
  return at === -1 ? email : email.slice(0, at);
}

export function validateUsername(username: string): string | null {
  const u = username.trim();
  if (!USERNAME_PATTERN.test(u)) {
    return "Username must be 3–30 chars: letters, numbers, . _ -";
  }
  return null;
}
