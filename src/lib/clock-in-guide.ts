/**
 * The Clock In / Out guide, and how long it stays on the dashboard.
 *
 * A new employee's first problem is not the roster or the payslip, it is the
 * POS by the door: nobody is paid for a shift they forgot to clock into. So
 * the guide is promoted to the top of their home screen the moment the owner
 * activates them, and it stands down again once they have had a fortnight of
 * shifts to learn the machine — by then the card is furniture, and furniture
 * on a dashboard is what teaches people to stop reading it.
 *
 * It never actually goes away, it only stops being urgent: the menu keeps it
 * under Schedule, beside the roster it belongs to, for the night six months
 * from now when somebody is covering a shift and cannot remember the steps.
 */

export const CLOCK_IN_GUIDE_HREF = "/staff/schedule/clock-in-guide";

/** How long the guide is promoted on the dashboard, counted from activation. */
export const GETTING_STARTED_WINDOW_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When the promotion lapses — activation plus the window, to the millisecond.
 *
 * Deliberately not rounded to a calendar day. An employee activated at 6pm on
 * a Tuesday keeps the card until 6pm a fortnight later, which is a whole
 * number of days of having it rather than thirteen and a bit.
 */
export function gettingStartedEndsAt(activatedAt: Date | null | undefined): Date | null {
  if (!activatedAt) return null;
  return new Date(activatedAt.getTime() + GETTING_STARTED_WINDOW_DAYS * DAY_MS);
}

/**
 * Is this employee still inside their first fortnight?
 *
 * `nowMs` is passed in rather than read from the clock so the caller owns the
 * timing. On the dashboard that is a state value which starts as null on the
 * server and is set after mount, which is what keeps the card from rendering
 * one way in the HTML and another in the browser.
 *
 * Someone with no `activatedAt` is not in the window. That is every record
 * that predates activation and every account still being onboarded, and
 * neither should be shown a card about starting shifts they cannot yet work.
 */
export function isWithinGettingStarted(
  activatedAt: Date | null | undefined,
  nowMs: number | null,
): boolean {
  if (nowMs === null) return false;
  const ends = gettingStartedEndsAt(activatedAt);
  return ends !== null && nowMs < ends.getTime();
}
