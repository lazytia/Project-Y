/**
 * The rates an employee has been paid at, as rows for the owner's
 * Employee Details page: the training period if they were hired on one,
 * then the standard rate they moved onto, then each change that has
 * started. Upcoming changes are not history — the page shows those as
 * scheduled.
 */

import { addDaysISO, sydneyTodayKey } from "./sydney-date";
import { readRateChanges, readStaffRates } from "./staff-rates";
import { normaliseTrainingPeriod, startDateISO, trainingEndDateISO } from "./staff-training";

export type RateHistoryRow = {
  kind: "training" | "standard";
  /** First day, or null when it is not known (no start date, or open-ended training). */
  fromISO: string | null;
  /** Last day, or null while it is still the rate in force. */
  toISO: string | null;
  weekday: number | null;
  saturday: number | null;
};

function numberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/** Newest first. */
export function readRateHistory(
  raw: Record<string, unknown>,
  todayISO: string = sydneyTodayKey(),
): RateHistoryRow[] {
  const startISO = startDateISO(raw) || null;
  const trainingRate = numberOrNull(raw.trainingRate);
  const trainingEnd = startISO
    ? trainingEndDateISO(startISO, normaliseTrainingPeriod(raw.trainingPeriod))
    : null;
  const { base } = readStaffRates(raw, todayISO);

  const rows: RateHistoryRow[] = [];
  if (trainingRate !== null) {
    rows.push({ kind: "training", fromISO: startISO, toISO: trainingEnd, weekday: trainingRate, saturday: null });
  }
  rows.push({
    kind: "standard",
    // After training when there was one; from the first day when there was not.
    fromISO: trainingRate !== null ? (trainingEnd ? addDaysISO(trainingEnd, 1) : null) : startISO,
    toISO: null,
    weekday: base.weekday,
    saturday: base.saturday,
  });
  for (const change of readRateChanges(raw)) {
    rows.push({
      kind: "standard",
      fromISO: change.effectiveFrom,
      toISO: null,
      weekday: change.weekday,
      saturday: change.saturday,
    });
  }

  // Only what has started. A row with no known start is kept: it is in the
  // past or in force, it just cannot be dated.
  const started = rows.filter((r) => r.fromISO === null || r.fromISO <= todayISO);

  // Each row ends the day before the next one starts, so the rate in force
  // reads as open-ended rather than as ending before a change still to come.
  for (let i = 0; i < started.length - 1; i += 1) {
    const nextFrom = started[i + 1].fromISO;
    const end = started[i].toISO;
    if (nextFrom && (end === null || end >= nextFrom)) {
      started[i].toISO = addDaysISO(nextFrom, -1);
    }
  }

  return started.reverse();
}
