type TeamMemberLike = { firstName?: string; lastName?: string };

export function timesheetStaffDisplayName(
  id: string,
  tm: TeamMemberLike | undefined,
): string {
  const first = (tm?.firstName ?? "").trim();
  const last = (tm?.lastName ?? "").trim();
  if (first || last) return `${first}${last ? " " + last : ""}`;
  return id.slice(0, 6);
}

/**
 * Boundary between the lunch and dinner halves of a day.
 *
 * Lunch service ends 14:15 and dinner starts 17:30, so nothing real starts
 * in between — 15:00 sits in that gap and matches the cut the booking side
 * already uses to decide which service a time belongs to.
 */
const DINNER_FROM = "15:00";

/**
 * Wall-clock "HH:MM" of a shift start.
 *
 * Timesheet timestamps are already in venue local time, and the rest of this
 * feature slices them rather than going through Date — which would
 * re-interpret them in the viewer's timezone and drift the split.
 */
function startHHMM(startAt: string): string {
  return startAt.slice(11, 16);
}

/** Which half of the day a shift belongs to. */
export type ShiftService = "lunch" | "dinner" | "unknown";

/** Reading order of the blocks — also what serviceRank sorts by. */
const SERVICE_ORDER: readonly ShiftService[] = ["lunch", "dinner", "unknown"];

const SERVICE_LABELS: Record<ShiftService, string> = {
  lunch: "Lunch",
  dinner: "Dinner",
  unknown: "No start time",
};

export function shiftService(startAt: string): ShiftService {
  const hhmm = startHHMM(startAt);
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return "unknown";
  return hhmm < DINNER_FROM ? "lunch" : "dinner";
}

function serviceRank(startAt: string): number {
  return SERVICE_ORDER.indexOf(shiftService(startAt));
}

/**
 * Heading to draw above row `index`, or null when that row carries on the
 * block above it.
 *
 * Expects a list already through sortShiftsByServiceThenStart — it only
 * compares each row against its predecessor, so an unsorted list would
 * produce a heading on nearly every row rather than silently mislabelling
 * one. Timeless shifts get their own heading instead of trailing under
 * "Dinner", which would read as a claim about when they started.
 */
export function serviceHeadingAt(
  shifts: readonly { startAt: string }[],
  index: number,
): string | null {
  const service = shiftService(shifts[index].startAt);
  if (index > 0 && shiftService(shifts[index - 1].startAt) === service) return null;
  return SERVICE_LABELS[service];
}

/**
 * Lunch shifts first, then dinner, each in clock order.
 *
 * This used to group by staff member, which parked someone's evening shift
 * directly under their lunch one. A day is staffed as two services, so that
 * made the one question the list exists to answer — who was on for lunch,
 * who was on for dinner — the one thing you could not read off it.
 *
 * Shifts with no usable start time sort last: they are broken records, and
 * leading the day with a blank row reads as a gap rather than a problem.
 */
export function sortShiftsByServiceThenStart<T extends { teamMemberId: string; startAt: string }>(
  shifts: T[],
  teamMembers: Record<string, TeamMemberLike>,
): T[] {
  return [...shifts].sort((a, b) => {
    const byService = serviceRank(a.startAt) - serviceRank(b.startAt);
    if (byService !== 0) return byService;
    const byStart = a.startAt.localeCompare(b.startAt);
    if (byStart !== 0) return byStart;
    const nameA = timesheetStaffDisplayName(a.teamMemberId, teamMembers[a.teamMemberId]);
    const nameB = timesheetStaffDisplayName(b.teamMemberId, teamMembers[b.teamMemberId]);
    return nameA.localeCompare(nameB, "en-AU");
  });
}
