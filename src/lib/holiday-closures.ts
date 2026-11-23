/**
 * Days the restaurant is closed over a holiday season, and when the dashboards
 * announce them.
 *
 * The banner shows from `showFrom` through `showUntil` (Sydney dates,
 * inclusive) and is gone by itself the day after — nobody has to remember to
 * take it down. For next season, replace the dates below.
 */

import { sydneyTodayKey } from "./sydney-date";

export type ClosurePeriod = {
  /** First closed day, YYYY-MM-DD. */
  from: string;
  /** Last closed day, YYYY-MM-DD (the same as `from` for a single day). */
  to: string;
};

export type HolidayClosures = {
  showFrom: string;
  showUntil: string;
  periods: ClosurePeriod[];
};

/** Christmas and New Year 2026–27. */
export const HOLIDAY_CLOSURES: HolidayClosures = {
  showFrom: "2026-11-23",
  showUntil: "2027-01-03",
  periods: [
    { from: "2026-12-25", to: "2026-12-28" },
    { from: "2027-01-01", to: "2027-01-03" },
  ],
};

/** The closures to announce today, or null outside the announcement window. */
export function activeHolidayClosures(
  todayISO: string = sydneyTodayKey(),
  closures: HolidayClosures = HOLIDAY_CLOSURES,
): ClosurePeriod[] | null {
  if (todayISO < closures.showFrom || todayISO > closures.showUntil) return null;
  return closures.periods.length > 0 ? closures.periods : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "25 – 28 Dec", "1 – 3 Jan", "31 Dec – 2 Jan", or "25 Dec" for one day. */
export function fmtClosurePeriod({ from, to }: ClosurePeriod): string {
  const [, fm, fd] = from.split("-").map(Number);
  const [, tm, td] = to.split("-").map(Number);
  if (from === to) return `${fd} ${MONTHS[fm - 1]}`;
  if (fm === tm) return `${fd} – ${td} ${MONTHS[tm - 1]}`;
  return `${fd} ${MONTHS[fm - 1]} – ${td} ${MONTHS[tm - 1]}`;
}
