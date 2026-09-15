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
  setupGuide: "/guide_link",
} as const;

export const PUBLIC_ROUTES: ReadonlySet<string> = new Set([ROUTES.login]);

/**
 * Subtrees that open without a session, matched by prefix.
 *
 * The setup guide is the only one. It is texted to a new hire the day they are
 * hired — instructions for installing an app they have a password for but have
 * never opened — so it has to render for someone with no session at all, and
 * so do the per-phone pages under it. Anything that bounced it to /login would
 * make the link in the welcome message a dead end.
 */
const PUBLIC_ROUTE_PREFIXES: readonly string[] = [ROUTES.setupGuide];

/**
 * Where the app answers in public.
 *
 * Deliberately a constant rather than window.location.origin. The only thing
 * that needs it is a link being put into a text message, and that message is
 * composed in whatever browser tab the owner happens to have open — a preview
 * build, or localhost. A new hire cannot be sent a link to somebody's laptop.
 */
export const PUBLIC_ORIGIN = "https://project.yurica.com.au";

/** Absolute URL for a path, for the places that leave the app. */
export function publicUrl(path: string): string {
  return `${PUBLIC_ORIGIN}${path}`;
}

/** Does this path open without signing in? */
export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_ROUTES.has(pathname)) return true;
  return PUBLIC_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

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
