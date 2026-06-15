export const ROUTES = {
  home: "/",
  login: "/login",
  staffOnboarding: "/onboarding",
  staffOnboardingComplete: "/onboarding/complete",
  reservations: "/operations/reservations",
} as const;

export const PUBLIC_ROUTES: ReadonlySet<string> = new Set([ROUTES.login]);

/**
 * Paths a non-owner (staff) user is allowed to visit. Anything outside this
 * set gets bounced to /onboarding. Once a staff member finishes the
 * onboarding flow they're routed to /operations/reservations, which is
 * their working homepage — so it must be reachable too.
 */
export function isStaffAllowedPath(pathname: string): boolean {
  return (
    pathname.startsWith(ROUTES.staffOnboarding) ||
    pathname.startsWith(ROUTES.reservations)
  );
}
