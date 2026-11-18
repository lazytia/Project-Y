/**
 * The house goals for what a week may cost, as a share of that week's gross
 * sales. One place, because Weekly Cost Control, Payroll Cost and Supplier
 * Cost all print them, and a target that differs between two screens is
 * worse than none.
 */

/** Payroll (total inc. super) as a share of sales. */
export const PAYROLL_TARGET_PCT = 35;

/** Supplier spend as a share of sales. */
export const SUPPLIER_TARGET_PCT = 25;

/** The two together. */
export const COMBINED_TARGET_PCT = PAYROLL_TARGET_PCT + SUPPLIER_TARGET_PCT;
