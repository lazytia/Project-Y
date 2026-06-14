export const ROUTES = {
  home: "/",
  login: "/login",
  staffOnboarding: "/onboarding",
} as const;

export const PUBLIC_ROUTES: ReadonlySet<string> = new Set([ROUTES.login]);

/**
 * Paths a non-owner (staff) user is allowed to visit. Anything outside this
 * set gets bounced to /onboarding.
 */
export function isStaffAllowedPath(pathname: string): boolean {
  return pathname.startsWith(ROUTES.staffOnboarding);
}
