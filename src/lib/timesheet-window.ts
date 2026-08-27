/**
 * Turning typed clock times back into a paid window.
 *
 * Everything an owner enters on a timesheet is a wall clock — "17:00",
 * "20:45". An instant needs two more things the form never asks for: which
 * calendar day the time falls on, and what the store's UTC offset was that
 * day. Guess either one wrong and the shift is out by hours of pay, which is
 * exactly how a 5:00 PM – 8:45 PM shift came to be filed as 27.75 hours: the
 * end kept the date off the record it was correcting, and that record was the
 * following afternoon.
 */

import { SYDNEY_TZ, addDaysISO } from "@/lib/sydney-date";

/**
 * Longer than any shift the restaurant actually runs, and short enough to
 * catch the way they go wrong. Square closes a forgotten clock-out by itself
 * at exactly 24 hours, so a record at or past this mark is a missing clock-out
 * rather than a long day — see `isImplausibleClockWindow`.
 */
export const MAX_PAID_SHIFT_HOURS = 16;

const OFFSET_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: SYDNEY_TZ,
  timeZoneName: "longOffset",
});

/** The store's offset from UTC, in minutes, at a given instant. */
function storeOffsetMinutesAt(utcMs: number): number {
  const name =
    OFFSET_FORMAT.formatToParts(new Date(utcMs)).find((p) => p.type === "timeZoneName")
      ?.value ?? "";
  // "GMT+10:00" in summer, "GMT+11:00" under daylight saving, plain "GMT" for
  // a zone sitting on UTC.
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!m) return 0;
  const mins = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === "-" ? -mins : mins;
}

function formatOffset(mins: number): string {
  const sign = mins < 0 ? "-" : "+";
  const abs = Math.abs(mins);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}

/**
 * A day and a wall clock in the store's timezone, as an unambiguous instant.
 *
 * The offset is read from the zone rather than assumed. Sydney spends half the
 * year at +11:00, so a fixed +10:00 silently moves every summer shift by an
 * hour — the same mistake that once shifted the booking reminders.
 */
export function storeIso(dateISO: string, hhmm: string): string {
  const naiveMs = Date.parse(`${dateISO}T${hhmm}:00Z`);
  if (!Number.isFinite(naiveMs)) return `${dateISO}T${hhmm}:00Z`;
  // The offset depends on the instant and the instant depends on the offset,
  // so read it twice: once at the naive guess, then again at the instant that
  // guess implies. The second reading is the one that survives a DST weekend.
  const guess = storeOffsetMinutesAt(naiveMs);
  const settled = storeOffsetMinutesAt(naiveMs - guess * 60_000);
  return `${dateISO}T${hhmm}:00${formatOffset(settled)}`;
}

/** Calendar day of an ISO instant, in the offset the string carries. */
export function dayOfIso(iso: string): string {
  return iso.slice(0, 10);
}

/** "HH:MM" of an ISO instant, in the offset the string carries. */
export function hhmmOfIso(iso: string | null): string {
  return iso ? iso.slice(11, 16) : "";
}

/**
 * The paid window for a shift that started on `dayISO`, from the two times as
 * typed.
 *
 * The start anchors the window; the end is simply the next time the clock
 * reads `endHHMM`. So an evening shift stays inside its own day, an overnight
 * one (10:00 PM – 1:00 AM) lands on the morning after, and — the part that
 * matters — no window can ever come out longer than a day. Editing a shift
 * used to keep whatever date the end already had, which meant a correction
 * could not pull an end back off the following afternoon no matter what the
 * owner typed.
 *
 * Equal times give a zero-length window rather than rolling over to 24 hours;
 * callers read that as "end must be after start" and refuse the save.
 */
export function paidWindow(
  dayISO: string,
  startHHMM: string,
  endHHMM: string,
): { startAt: string; endAt: string } {
  const startAt = storeIso(dayISO, startHHMM);
  const sameDayEnd = storeIso(dayISO, endHHMM);
  if (Date.parse(sameDayEnd) >= Date.parse(startAt)) {
    return { startAt, endAt: sameDayEnd };
  }
  return { startAt, endAt: storeIso(addDaysISO(dayISO, 1), endHHMM) };
}

/**
 * Rebuild a paid window after one of its two times was retyped.
 *
 * `currentEnd` may be null — an open shift, or one whose clock-out we refused
 * to believe — in which case the typed end is placed against the start like
 * any other.
 */
export function paidWindowAfterEdit(
  currentStart: string,
  currentEnd: string | null,
  field: "start" | "end",
  newHHMM: string,
): { startAt: string; endAt: string } {
  const startHHMM = field === "start" ? newHHMM : hhmmOfIso(currentStart);
  const endHHMM = field === "end" ? newHHMM : hhmmOfIso(currentEnd);
  return paidWindow(dayOfIso(currentStart), startHHMM, endHHMM);
}

/** Paid hours of a window, to the cent of an hour. Never negative. */
export function hoursOfWindow(startAt: string, endAt: string | null): number {
  if (!endAt) return 0;
  const ms = Date.parse(endAt) - Date.parse(startAt);
  if (!Number.isFinite(ms)) return 0;
  const h = Math.round((ms / 3_600_000) * 100) / 100;
  return h > 0 ? h : 0;
}

/** Does this window finish on a later calendar day than it started? */
export function endsNextDay(startAt: string, endAt: string | null): boolean {
  return !!endAt && dayOfIso(endAt) !== dayOfIso(startAt);
}

/**
 * A clock record too long to be a shift somebody worked.
 *
 * Staff forget to clock out, and Square eventually closes the shift for them —
 * always at exactly 24 hours after the clock-in, which then reads as a full
 * day's pay. Eight of these turned up in one year. Treating them as unfinished
 * puts the row in front of the owner with nothing on it instead of quietly
 * pricing a day nobody worked.
 */
export function isImplausibleClockWindow(
  startIso: string,
  endIso: string | null,
): boolean {
  if (!endIso) return false;
  const ms = Date.parse(endIso) - Date.parse(startIso);
  if (!Number.isFinite(ms)) return false;
  return ms / 3_600_000 >= MAX_PAID_SHIFT_HOURS;
}
