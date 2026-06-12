// Internal domain used to convert usernames into Firebase Auth emails.
// Users never see this — it exists only so Firebase Auth's email/password
// provider can store accounts that the user thinks of as "username + password".
const INTERNAL_DOMAIN = "projecty.local";

const USERNAME_PATTERN = /^[a-z0-9._-]{3,30}$/;

export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${INTERNAL_DOMAIN}`;
}

export function emailToUsername(email: string | null | undefined): string {
  if (!email) return "";
  const at = email.indexOf("@");
  return at === -1 ? email : email.slice(0, at);
}

export function validateUsername(username: string): string | null {
  const u = username.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(u)) {
    return "Username must be 3–30 chars: lowercase letters, numbers, . _ -";
  }
  return null;
}
