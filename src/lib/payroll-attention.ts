/** Helpers for timesheet payroll attention (training end / wage increase). */

import {
  OPEN_ENDED_TRAINING_PERIOD,
  fmtTrainingEndLong,
  trainingEndDateISO,
} from "./staff-training";

// Re-exported because this module was the training period's only home for a
// long time and the timesheet imports it from here.
export { trainingEndDateISO };

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

function isApprovedStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s === "approved" || s === "active";
}

export function isPayrollReminderEligible(row: PayrollStaffRecord): boolean {
  if (!row.accountCreated || !isApprovedStatus(row.status)) return false;
  if (row.payrollRateReminderActive === false) return false;
  if (row.trainingRate == null || row.afterTrainingRate == null) return false;
  if (row.afterTrainingRate <= row.trainingRate) return false;
  if (row.trainingPeriod === OPEN_ENDED_TRAINING_PERIOD) return false;
  return true;
}

/**
 * Returns true when this approved employee should appear in Payroll Attention.
 * Shown from owner approval until the owner dismisses the reminder — not gated
 * on the timesheet date range (training end is often weeks after hire).
 */
export function shouldShowPayrollAttention(
  trainingEndISO: string | null,
  dismissedFor: string,
): boolean {
  if (!trainingEndISO) return false;
  if (dismissedFor === trainingEndISO) return false;
  return true;
}

export function buildPayrollAttentionItems(
  staff: PayrollStaffRecord[],
): PayrollAttentionItem[] {
  const items: PayrollAttentionItem[] = [];

  for (const row of staff) {
    const status = (row.status ?? "").toLowerCase();
    if (status === "terminated") continue;
    if (!isPayrollReminderEligible(row)) continue;

    const trainingEndISO = trainingEndDateISO(row.startDate, row.trainingPeriod);
    if (!shouldShowPayrollAttention(trainingEndISO, row.payrollRateNotedFor)) {
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

export function trainingEndStatusLabel(iso: string, todayISO: string): string {
  const prefix = iso >= todayISO ? "Training period ends" : "Training period ended";
  return `${prefix}: ${fmtTrainingEndLabel(iso)}`;
}

/** Alias kept for the timesheet, which has always called it this. */
export function fmtTrainingEndLabel(iso: string): string {
  return fmtTrainingEndLong(iso);
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
  if (trainingPeriod === OPEN_ENDED_TRAINING_PERIOD) return false;
  return true;
}
