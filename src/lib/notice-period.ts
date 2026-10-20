/**
 * How much notice staff give before a change to their own schedule.
 *
 * One figure for everything that asks for it — a holiday request and an
 * availability change alike — matching the employment agreement and the
 * handbook. It used to be written out on each page, and the two drifted: the
 * holiday page moved to two weeks and the availability page's wording followed,
 * but its date calculation kept adding three weeks, so the form told staff "2
 * weeks notice" and then started the change a week later than that.
 *
 * Change it here and both pages, and the wording that quotes the number, move
 * together. The written policy in the agreement and handbook text is prose and
 * has to be edited by hand.
 */
// TEMPORARILY 0, so a request can be dated today while the roster's handling of
// holidays and unavailable days is tried out. The policy is two weeks: put this
// back to 2 afterwards. At 0 the two forms still print "0 weeks notice".
export const NOTICE_WEEKS = 0;
export const NOTICE_DAYS = NOTICE_WEEKS * 7;
