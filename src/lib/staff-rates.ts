/**
 * Per-employee hourly rates.
 *
 * Square only stores one wage per team member, so the app keeps its own
 * rates on `staff_onboarding/{uid}` and applies them to every imported
 * shift. Saturday is paid at its own rate; Sun–Fri share the weekday one.
 * These are base rates — penalties and allowances are applied on top.
 */

export type StaffRates = {
  weekday: number | null;
  saturday: number | null;
};

const SATURDAY_DOW = 6;

function numberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Employees onboarded before the rate card existed only have the legacy
 * training rates, so fall back to those rather than showing nothing.
 */
export function readStaffRates(raw: Record<string, unknown>): StaffRates {
  return {
    weekday:
      numberOrNull(raw.weekdayRate) ??
      numberOrNull(raw.afterTrainingRate) ??
      numberOrNull(raw.trainingRate),
    saturday: numberOrNull(raw.saturdayRate),
  };
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
  if (isSaturdayISO(dateISO)) return rates.saturday ?? rates.weekday;
  return rates.weekday;
}
