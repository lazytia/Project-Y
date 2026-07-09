/** Helpers for timesheet payroll attention (training end / wage increase). */

export type PayrollStaffRecord = {
  uid: string;
  name: string;
  position: string;
  startDate: string;
  trainingPeriod: string;
  trainingRate: number | null;
  afterTrainingRate: number | null;
  payrollRateNotedFor: string;
  payrollRateReminderActive: boolean;
  accountCreated: boolean;
  status: string;
};

export type PayrollAttentionItem = {
  staffUid: string;
  name: string;
  position: string;
  trainingEndISO: string;
  currentRate: number;
  newRate: number;
};

function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function isApprovedStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s === "approved" || s === "active";
}

/** Last day of the training period (inclusive), based on start date + period length. */
export function trainingEndDateISO(startISO: string, period: string): string | null {
  if (!startISO || period === "Until Fully Trained") return null;
  const extraDays =
    period === "First 3 Weeks" ? 20 : period === "First 2 Weeks" ? 13 : null;
  if (extraDays === null) return null;
  return addDaysISO(startISO, extraDays);
}

export function isPayrollReminderEligible(row: PayrollStaffRecord): boolean {
  if (!row.accountCreated || !isApprovedStatus(row.status)) return false;
  if (row.payrollRateReminderActive === false) return false;
  if (row.trainingRate == null || row.afterTrainingRate == null) return false;
  if (row.afterTrainingRate <= row.trainingRate) return false;
  if (row.trainingPeriod === "Until Fully Trained") return false;
  return true;
}

/**
 * Returns true when this approved employee should appear in Payroll Attention
 * for the selected timesheet range.
 */
export function shouldShowPayrollAttention(
  trainingEndISO: string | null,
  rangeStart: string,
  rangeEnd: string,
  dismissedFor: string,
): boolean {
  if (!trainingEndISO) return false;
  if (dismissedFor === trainingEndISO) return false;
  return trainingEndISO >= rangeStart && trainingEndISO <= rangeEnd;
}

export function buildPayrollAttentionItems(
  staff: PayrollStaffRecord[],
  rangeStart: string,
  rangeEnd: string,
): PayrollAttentionItem[] {
  const items: PayrollAttentionItem[] = [];

  for (const row of staff) {
    const status = (row.status ?? "").toLowerCase();
    if (status === "terminated") continue;
    if (!isPayrollReminderEligible(row)) continue;

    const trainingEndISO = trainingEndDateISO(row.startDate, row.trainingPeriod);
    if (
      !shouldShowPayrollAttention(
        trainingEndISO,
        rangeStart,
        rangeEnd,
        row.payrollRateNotedFor,
      )
    ) {
      continue;
    }

    items.push({
      staffUid: row.uid,
      name: row.name,
      position: row.position,
      trainingEndISO: trainingEndISO!,
      currentRate: row.trainingRate!,
      newRate: row.afterTrainingRate!,
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

export function shouldActivatePayrollReminder(raw: {
  trainingRate?: unknown;
  afterTrainingRate?: unknown;
  trainingPeriod?: unknown;
}): boolean {
  const trainingRate =
    typeof raw.trainingRate === "number" ? raw.trainingRate : null;
  const afterTrainingRate =
    typeof raw.afterTrainingRate === "number" ? raw.afterTrainingRate : null;
  const trainingPeriod =
    typeof raw.trainingPeriod === "string" ? raw.trainingPeriod : "";
  if (trainingRate == null || afterTrainingRate == null) return false;
  if (afterTrainingRate <= trainingRate) return false;
  if (trainingPeriod === "Until Fully Trained") return false;
  return true;
}
