/**
 * The training period a new hire is taken on under.
 *
 * The New Staff Request form has always captured three things — a training
 * rate, a period, and the rate that follows it — and payroll already turns
 * them into a reminder to raise the wage. Nothing showed the employee's own
 * pages that they were still inside it, so the roster read as if everyone
 * was on their full rate from day one.
 *
 * The period is stored as the words the manager picked, not a number of
 * days, so the length lives here next to the label rather than being
 * re-derived wherever an end date is needed.
 */

import { tsToDate, todayIso } from "./staff-display";

export const TRAINING_PERIODS = [
  { value: "First 2 Weeks", weeks: 2, subtitle: "" },
  { value: "First 3 Weeks", weeks: 3, subtitle: "" },
  {
    value: "Until Fully Trained",
    weeks: null,
    subtitle: "Until the person can perform their duties in full capacity",
  },
] as const;

export type TrainingPeriod = (typeof TRAINING_PERIODS)[number]["value"];

export const DEFAULT_TRAINING_PERIOD: TrainingPeriod = "First 2 Weeks";

/** The open-ended option: there is no date to count down to. */
export const OPEN_ENDED_TRAINING_PERIOD: TrainingPeriod = "Until Fully Trained";

export function normaliseTrainingPeriod(raw: unknown): TrainingPeriod {
  const s = String(raw ?? "").trim();
  const match = TRAINING_PERIODS.find((p) => p.value === s);
  return match ? match.value : DEFAULT_TRAINING_PERIOD;
}

function weeksOf(period: string): number | null {
  return TRAINING_PERIODS.find((p) => p.value === period)?.weeks ?? null;
}

function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/**
 * Last day of the training period (inclusive), or null when it is
 * open-ended — "Until Fully Trained" is a judgement, not a date, and
 * inventing one would put a countdown on screen nobody agreed to.
 */
export function trainingEndDateISO(startISO: string, period: string): string | null {
  const weeks = weeksOf(period);
  if (!startISO || weeks === null) return null;
  return addDaysISO(startISO, weeks * 7 - 1);
}

/** ISO date from whatever shape `startDate` was written in. */
export function startDateISO(raw: Record<string, unknown>): string {
  const d = tsToDate(raw.startDate);
  if (!d) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export type TrainingStatus = {
  period: TrainingPeriod;
  /** What they are paid while training, or null when it was never set. */
  rate: number | null;
  /** Inclusive last day, or null when the period is open-ended. */
  endISO: string | null;
  /** Whole days from today to the last day. 0 = today is the last day. */
  daysRemaining: number | null;
  /** Still inside the period today. Drives the pill and the countdown. */
  active: boolean;
};

function numberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Where an employee stands in their training period, today.
 *
 * Open-ended periods are deliberately never `active`: with no end date there
 * is nothing to count down, and a pill that never clears would follow the
 * employee around the roster forever.
 */
export function readTrainingStatus(
  raw: Record<string, unknown>,
  today: string = todayIso(),
): TrainingStatus {
  const period = normaliseTrainingPeriod(raw.trainingPeriod);
  const endISO = trainingEndDateISO(startDateISO(raw), period);
  const daysRemaining = endISO === null ? null : daysBetweenISO(today, endISO);
  return {
    period,
    rate: numberOrNull(raw.trainingRate),
    endISO,
    daysRemaining,
    active: daysRemaining !== null && daysRemaining >= 0,
  };
}

/** Whole-day difference between two ISO dates. Positive = `to` is later. */
function daysBetweenISO(fromISO: string, toISO: string): number | null {
  const [fy, fm, fd] = fromISO.split("-").map(Number);
  const [ty, tm, td] = toISO.split("-").map(Number);
  if (!fy || !fm || !fd || !ty || !tm || !td) return null;
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return Math.round((to - from) / 86_400_000);
}

/** "4 Sep" — the short form the roster rows use for a training day. */
export function fmtTrainingEndShort(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "—";
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
  });
}

/** "11 Sep 2026" — the long form the employee's own page uses. */
export function fmtTrainingEndLong(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "—";
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
