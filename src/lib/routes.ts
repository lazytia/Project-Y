import type { User } from "firebase/auth";
import { isChef, isOwner } from "./permissions";

export const ROUTES = {
  home: "/",
  login: "/login",
  staffOnboarding: "/onboarding",
  staffOnboardingComplete: "/onboarding/complete",
  staffNotificationsPrompt: "/onboarding/notifications",
  staffHome: "/staff",
  chefHome: "/chef",
  staffSchedule: "/staff/schedule",
  staffScheduleRoster: "/staff/schedule/roster",
  staffScheduleRequestHoliday: "/staff/schedule/request-holiday",
  staffScheduleAvailability: "/staff/schedule/availability-change",
  staffPayslips: "/staff/payslips",
  staffDocuments: "/staff/documents",
  staffHandbook: "/staff/handbook",
  staffBeerGuide: "/staff/beer-guide",
  reservations: "/operations/reservations",
} as const;

export const PUBLIC_ROUTES: ReadonlySet<string> = new Set([ROUTES.login]);

/**
 * This user's dashboard — the screen that is "home" for them.
 *
 * Owners, the manager and the chefs share the one at `/`; everybody else has
 * `/staff`. Signing in lands on it and every Back button returns to it, so the
 * two must agree, which is why they are the same function.
 */
export function dashboardRoute(user: User | null | undefined): string {
  if (!user) return ROUTES.home;
  if (isOwner(user) || isChef(user)) return ROUTES.home;
  return ROUTES.staffHome;
}

/** First screen after sign-in — must match AuthProvider routing. */
export function postLoginRoute(user: User): string {
  return dashboardRoute(user);
}

/**
 * Paths a non-owner (staff) user is allowed to visit. Anything outside this
 * set gets bounced to /onboarding. Once a staff member finishes the
 * onboarding flow they're routed to /operations/reservations, which is
 * their working homepage — so it must be reachable too.
 */
export function isStaffAllowedPath(pathname: string): boolean {
  return (
    pathname.startsWith(ROUTES.staffOnboarding) ||
    pathname.startsWith(ROUTES.staffHome) ||
    pathname.startsWith(ROUTES.staffHandbook) ||
    pathname.startsWith(ROUTES.staffBeerGuide) ||
    pathname.startsWith(ROUTES.chefHome) ||
    pathname.startsWith(ROUTES.reservations)
  );
}
