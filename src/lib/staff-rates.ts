/**
 * Per-employee hourly rates.
 *
 * Square only stores one wage per team member, so the app keeps its own
 * rates on `staff_onboarding/{uid}` and applies them to every imported
 * shift. Saturday is paid at its own rate; Sun–Fri share the weekday one.
 * These are base rates — penalties and allowances are applied on top.
 *
 * A raise is scheduled rather than typed over the old rate: the owner sets
 * the new pair and the day it starts, and it is kept in `rateChanges` next to
 * the rates it replaces. A pay week can straddle that day, so a shift is paid
 * at the rate of the day it was worked — never at whatever the rate happens
 * to be on the day the timesheet is read.
 */

import { addDaysISO, sydneyTodayKey } from "./sydney-date";

/** New rates from a given day on. */
export type RateChange = {
  /** First day worked at the new rates, YYYY-MM-DD (Sydney). */
  effectiveFrom: string;
  weekday: number;
  saturday: number | null;
  /** Day it was scheduled, YYYY-MM-DD (Sydney), when known. */
  scheduledOn?: string | null;
};

export type RateSet = {
  weekday: number | null;
  saturday: number | null;
};

export type StaffRates = RateSet & {
  /** What was paid before the first change. */
  base: RateSet;
  /** Every change, past and upcoming, oldest first. */
  changes: RateChange[];
};

/** Field on `staff_onboarding/{uid}` that holds the changes. */
export const RATE_CHANGES_FIELD = "rateChanges";

/**
 * How long the employee's payslip page announces a change: the week before
 * it starts. One week means it shows over exactly one weekly payday, so each
 * change is announced once rather than on every payslip after it. A change
 * entered with less notice than that — or backdated — is announced for a
 * week from the day it was entered instead, so it is never missed.
 */
export const RATE_NOTICE_DAYS = 7;

const SATURDAY_DOW = 6;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function numberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Employees onboarded before the rate card existed only have the legacy
 * training rates, so fall back to those rather than showing nothing.
 */
function readBaseRates(raw: Record<string, unknown>): RateSet {
  return {
    weekday:
      numberOrNull(raw.weekdayRate) ??
      numberOrNull(raw.afterTrainingRate) ??
      numberOrNull(raw.trainingRate),
    saturday: numberOrNull(raw.saturdayRate),
  };
}

/** The Sydney calendar day of a stored ISO timestamp, or null. */
function sydneyDayOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const at = new Date(v);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
}

/** The stored changes, oldest first. One per day: a later entry for the same day wins. */
export function readRateChanges(raw: Record<string, unknown>): RateChange[] {
  const list = raw[RATE_CHANGES_FIELD];
  if (!Array.isArray(list)) return [];
  const byDay = new Map<string, RateChange>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const effectiveFrom = typeof entry.effectiveFrom === "string" ? entry.effectiveFrom : "";
    const weekday = numberOrNull(entry.weekdayRate);
    if (!ISO_DATE.test(effectiveFrom) || weekday === null) continue;
    byDay.set(effectiveFrom, {
      effectiveFrom,
      weekday,
      saturday: numberOrNull(entry.saturdayRate),
      scheduledOn: sydneyDayOf(entry.scheduledAt),
    });
  }
  return [...byDay.values()].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

/** The rates that pay for work done on `dateISO`. */
export function ratesOn(rates: Pick<StaffRates, "base" | "changes">, dateISO: string): RateSet {
  let current = rates.base;
  for (const change of rates.changes) {
    if (change.effectiveFrom > dateISO) break;
    current = { weekday: change.weekday, saturday: change.saturday };
  }
  return current;
}

/** Rates in force on `todayISO`, plus everything needed to pay any other day. */
export function readStaffRates(
  raw: Record<string, unknown>,
  todayISO: string = sydneyTodayKey(),
): StaffRates {
  const base = readBaseRates(raw);
  const changes = readRateChanges(raw);
  return { ...ratesOn({ base, changes }, todayISO), base, changes };
}

/** Changes that have not started yet, soonest first. */
export function upcomingRateChanges(rates: StaffRates, todayISO: string = sydneyTodayKey()): RateChange[] {
  return rates.changes.filter((c) => c.effectiveFrom > todayISO);
}

/**
 * The change the employee should be told about today, or null: shown from
 * RATE_NOTICE_DAYS before it starts until it starts — or, when it was entered
 * later than that, for RATE_NOTICE_DAYS from the day it was entered.
 */
export function rateChangeToAnnounce(
  changes: RateChange[],
  todayISO: string = sydneyTodayKey(),
): RateChange | null {
  const showing = changes.filter((c) => {
    if (todayISO < addDaysISO(c.effectiveFrom, -RATE_NOTICE_DAYS)) return false;
    const enteredLate = c.scheduledOn ? addDaysISO(c.scheduledOn, RATE_NOTICE_DAYS) : "";
    const until = enteredLate > c.effectiveFrom ? enteredLate : c.effectiveFrom;
    return todayISO < until;
  });
  // The newest one, if two overlap: it is the rate they are about to be paid.
  return showing[showing.length - 1] ?? null;
}

export function isSaturdayISO(dateISO: string): boolean {
  const [y, m, d] = dateISO.split("-").map(Number);
  if (!y || !m || !d) return false;
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() === SATURDAY_DOW;
}

/** Dollars per hour for the day a shift falls on, or null when unconfigured. */
export function rateForDateISO(
  rates: StaffRates | undefined,
  dateISO: string,
): number | null {
  if (!rates) return null;
  const on = ratesOn(rates, dateISO);
  if (isSaturdayISO(dateISO)) return on.saturday ?? on.weekday;
  return on.weekday;
}
