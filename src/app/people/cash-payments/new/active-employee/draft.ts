/**
 * Shared types + storage key for the Active Employee cash payment two-step form.
 */

export const ACTIVE_DRAFT_KEY = "cashPayment_activeEmployee_draft";

export type ActiveEmployeeDraft = {
  employeeUid: string;
  employeeName: string;
  employeePosition: string;
  paymentType: "Payroll Adjustment" | "Advance Payment" | "Final Pay";
  amount: number;       // parsed float
  amountStr: string;    // raw input string
  reason: string;
  paymentDate: string;  // YYYY-MM-DD
};
