/**
 * The moment a new employee first signs in successfully.
 *
 * The owner sets an account up days before the person uses it, and until now
 * nothing said whether they ever had. `firstLoginAt` is stamped once, by the
 * session route, from a verified ID token — so it records a sign-in that
 * actually happened rather than a page that happened to load.
 *
 * Pure module on purpose: the server writes the stamp and the bell reads it,
 * and both need the same idea of how long the news stays news.
 */

export const FIRST_LOGIN_FIELD = "firstLoginAt";

/**
 * How long a first sign-in keeps its place in the owner's bell.
 *
 * It is news, not a task — there is nothing to approve or clear, so unlike a
 * pending request it has to expire on its own. A week is long enough to
 * survive the owner's days off.
 */
export const FIRST_LOGIN_NOTICE_DAYS = 7;

/**
 * Is this first sign-in recent enough to still show?
 *
 * The small negative tolerance is for clock skew: the stamp is written by the
 * server and read on a phone that may be a little ahead of it, and a
 * notification that arrives "in the future" should not be invisible.
 */
export function isFirstLoginRecent(at: Date | null, now: Date = new Date()): boolean {
  if (!at) return false;
  const elapsedDays = (now.getTime() - at.getTime()) / 86_400_000;
  return elapsedDays >= -1 && elapsedDays <= FIRST_LOGIN_NOTICE_DAYS;
}

/**
 * How soon after authenticating a session refresh still counts as a sign-in.
 *
 * The session endpoint is re-POSTed on every token refresh, page show and
 * visibility change, so it cannot tell a sign-in from a reload — but the ID
 * token's `auth_time` can. Anything older than this window is a session being
 * kept alive, and is left alone rather than costing a Firestore read.
 */
export const FRESH_SIGN_IN_WINDOW_SECONDS = 5 * 60;

export function isFreshSignIn(authTimeSeconds: number | undefined, now: Date = new Date()): boolean {
  if (typeof authTimeSeconds !== "number" || !Number.isFinite(authTimeSeconds)) return false;
  const elapsed = now.getTime() / 1000 - authTimeSeconds;
  return elapsed >= -FRESH_SIGN_IN_WINDOW_SECONDS && elapsed <= FRESH_SIGN_IN_WINDOW_SECONDS;
}
