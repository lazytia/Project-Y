import { dowOfDateKey } from "@/lib/sydney-date";

/**
 * The figures the dashboards measure the day and the week against.
 *
 * Written out twice before this — once on the owner dashboard, once on the
 * manager's — and the chef's would have been the third copy. The owner's also
 * carried the weekly figure as a literal 31,500, which is the seven daily
 * figures added up: right on the day it was typed, and quietly wrong the first
 * time one of the days moved without it. The week is derived here instead, so
 * the two cannot disagree.
 */
export const DAILY_SALES_TARGETS: Readonly<Record<number, number>> = {
  0: 0, 1: 4_000, 2: 5_500, 3: 6_000, 4: 6_000, 5: 6_000, 6: 4_000,
};

/** The seven daily targets added up. Sunday is closed and contributes nothing. */
export const WEEKLY_SALES_TARGET = Object.values(DAILY_SALES_TARGETS).reduce(
  (sum, n) => sum + n,
  0,
);

/**
 * The target for one Sydney date key.
 *
 * Goes through dowOfDateKey, which reads the weekday at local noon. A date key
 * parsed at midnight lands on the day before for half the year, which would
 * hand Monday the Sunday target of nothing.
 */
export function dailySalesTarget(dateKey: string): number {
  if (!dateKey) return 0;
  return DAILY_SALES_TARGETS[dowOfDateKey(dateKey)] ?? 0;
}

/**
 * Progress towards a target as a whole percentage, capped at 100.
 *
 * Null rather than 0 when there is nothing to divide: Sunday has no target at
 * all, and a figure Square has not answered for yet is not the same thing as
 * no sales. The caller decides what to print for "not known".
 */
export function targetPct(value: number | null, target: number): number | null {
  if (value === null || target <= 0) return null;
  return Math.min(100, Math.round((value / target) * 100));
}
