import { ROUTES } from "./routes";
import { TOTAL_ONBOARDING_STEPS } from "./onboarding-steps";

/* ──────────────────────────────────────────────────────────────────────
 * Who may see the staff app.
 *
 * An employee gets the dashboard and the rest of the menu only once they have
 * finished every onboarding step, signatures included, and the owner has
 * activated them. Until then they stay on the onboarding screens.
 *
 * That is decided from two facts read off the employee's own document, and
 * both arrive late: the document is fetched after sign-in, so for the first
 * moments the app does not know how far they have got. The gate used to treat
 * "don't know yet" as "no lock", which is a hole rather than a courtesy —
 * somebody who had signed nothing was shown the dashboard until the document
 * arrived, and for as long as it was slow to, or never did. It now works the
 * other way round: the app opens only for somebody it knows to be cleared.
 * ──────────────────────────────────────────────────────────────────── */

export type StaffGateInput = {
  /** A plain employee: not an owner, the manager or a chef, who never go through onboarding. */
  isStaff: boolean;
  /** Steps finished; null until the employee's document has answered. */
  completedStep: number | null;
  /** Has the owner activated them; null until the document has answered. */
  activated: boolean | null;
};

/**
 * Must this person be kept out of the staff app?
 *
 * Only an employee known to have finished the last step and to have been
 * activated is let in. Everyone else — still filling the form, waiting for the
 * owner, or not yet known either way — is locked.
 */
export function isStaffAppLocked({ isStaff, completedStep, activated }: StaffGateInput): boolean {
  if (!isStaff) return false;
  const finished = completedStep !== null && completedStep >= TOTAL_ONBOARDING_STEPS;
  return !(finished && activated === true);
}

/**
 * Where a locked employee may be: the onboarding screens, and the settings page
 * so they can still switch language while filling the form in. The same two
 * places AuthProvider's redirect leaves alone.
 */
export function isLockedStaffPath(pathname: string): boolean {
  return pathname.startsWith(ROUTES.staffOnboarding) || pathname === "/staff/settings";
}
