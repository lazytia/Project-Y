/** Helpers for timesheet payroll attention (training end / wage increase). */

export type PayrollStaffRecord = {
  uid: string;
  name: string;
  position: string;
  startDate: string;
  trainingPeriod: string;
  trainingRate: number | null;
  afterTrainingRate: number | null;
  squareTeamMemberId: string;
  payrollRateNotedFor: string;
  status: string;
};

export type PayrollAttentionItem = {
  staffUid: string;
  teamMemberId: string;
  name: string;
  position: string;
  trainingEndISO: string;
  currentRate: number;
  newRate: number;
  noted: boolean;
};

function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** Last day of the training period (inclusive), based on start date + period length. */
export function trainingEndDateISO(startISO: string, period: string): string | null {
  if (!startISO || period === "Until Fully Trained") return null;
  const extraDays =
    period === "First 3 Weeks" ? 20 : period === "First 2 Weeks" ? 13 : null;
  if (extraDays === null) return null;
  return addDaysISO(startISO, extraDays);
}

function ratesEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

/**
 * Returns true when this employee should appear in Payroll Attention for the
 * selected timesheet range.
 */
export function shouldShowPayrollAttention(
  trainingEndISO: string | null,
  trainingRate: number | null,
  afterRate: number | null,
  rangeStart: string,
  rangeEnd: string,
  squareRateDollars: number | null,
): boolean {
  if (!trainingEndISO || trainingRate == null || afterRate == null) return false;
  if (afterRate <= trainingRate) return false;

  const endsInRange = trainingEndISO >= rangeStart && trainingEndISO <= rangeEnd;
  const endedAndStillOnTrainingRate =
    trainingEndISO <= rangeEnd &&
    squareRateDollars !== null &&
    ratesEqual(squareRateDollars, trainingRate) &&
    !ratesEqual(squareRateDollars, afterRate);

  if (!endsInRange && !endedAndStillOnTrainingRate) return false;

  if (squareRateDollars !== null && ratesEqual(squareRateDollars, afterRate)) {
    return false;
  }

  return true;
}

export function buildPayrollAttentionItems(
  staff: PayrollStaffRecord[],
  rangeStart: string,
  rangeEnd: string,
  squareRateByMember: Record<string, number | null>,
): PayrollAttentionItem[] {
  const items: PayrollAttentionItem[] = [];

  for (const row of staff) {
    if (!row.squareTeamMemberId) continue;
    const status = (row.status ?? "").toLowerCase();
    if (status === "terminated") continue;

    const trainingEndISO = trainingEndDateISO(row.startDate, row.trainingPeriod);
    const squareRate = squareRateByMember[row.squareTeamMemberId] ?? null;

    if (
      !shouldShowPayrollAttention(
        trainingEndISO,
        row.trainingRate,
        row.afterTrainingRate,
        rangeStart,
        rangeEnd,
        squareRate,
      )
    ) {
      continue;
    }

    items.push({
      staffUid: row.uid,
      teamMemberId: row.squareTeamMemberId,
      name: row.name,
      position: row.position,
      trainingEndISO: trainingEndISO!,
      currentRate: row.trainingRate!,
      newRate: row.afterTrainingRate!,
      noted: row.payrollRateNotedFor === trainingEndISO,
    });
  }

  return items.sort((a, b) => a.trainingEndISO.localeCompare(b.trainingEndISO));
}

export function fmtTrainingEndLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
