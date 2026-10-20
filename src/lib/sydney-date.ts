export const SYDNEY_TZ = "Australia/Sydney";

export function sydneyTodayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: SYDNEY_TZ });
}

/**
 * The hour of the day right now in Sydney, 0–23.
 *
 * Read out of Intl rather than by shifting UTC, because the offset is +10 or
 * +11 depending on the date and a fixed one is wrong for half the year.
 *
 * `hourCycle: "h23"` is load-bearing: with `hour12: false` several engines
 * render midnight as "24", which would compare as later than every deadline
 * in the day.
 */
export function sydneyHourNow(): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SYDNEY_TZ,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  return Number(parts.find((p) => p.type === "hour")?.value ?? "0");
}

export function dowOfDateKey(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

export function isoMondayOf(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - dow);
  return dt.toISOString().slice(0, 10);
}

/** The first Monday on or after `dateKey`; a Monday is its own answer. */
export function mondayOnOrAfter(dateKey: string): string {
  // Days to add by weekday (Sun=0): Sun 1, Mon 0, Tue 6, ... Sat 2.
  return addDaysISO(dateKey, (8 - dowOfDateKey(dateKey)) % 7);
}

export function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
