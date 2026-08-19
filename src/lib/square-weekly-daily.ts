import { adminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { fetchDailyGrossSalesFromReporting } from "@/lib/square-reporting";
import {
  fetchOrders,
  getSalesDayRange,
  shiftDateKey,
  squareEnv,
  squareGrossSalesCents,
  sumRefundCentsByService,
} from "@/lib/square";

/** Bump when gross-sales formula or data source changes. */
export const WEEKLY_DAILY_COMPUTE_VERSION = 2;

/**
 * True when a cached week can be trusted as the week's settled total.
 *
 * Finished weeks are cached forever, so a document written mid-week — holding
 * zeros for the days that had not happened yet — would otherwise stay frozen
 * at a partial figure. Only a snapshot taken after the last day of the week
 * counts as complete.
 */
export function weekCacheIsSettled(
  weekStart: string,
  computedAt: Date | null | undefined,
  timezone: string,
): boolean {
  if (!computedAt) return false;
  const weekEnd = shiftDateKey(weekStart, 6, timezone);
  return computedAt.toLocaleDateString("en-CA", { timeZone: timezone }) > weekEnd;
}

export async function computeWeekPair(
  locationId: string,
  timezone: string,
  weekStart: string,
): Promise<{
  thisWeek: { daily: number[]; total: number };
  lastWeek: { daily: number[]; total: number };
}> {
  const prevWeekStart = shiftDateKey(weekStart, -7, timezone);
  const weekEnd = shiftDateKey(weekStart, 6, timezone);

  const daily = await fetchDailyGrossSalesFromReporting(prevWeekStart, weekEnd, locationId);

  function seven(mondayKey: string) {
    const values: number[] = [];
    for (let i = 0; i < 7; i++) {
      const dk = shiftDateKey(mondayKey, i, timezone);
      values.push(daily.get(dk) ?? 0);
    }
    const total = Math.round(values.reduce((s, v) => s + v, 0) * 100) / 100;
    return { daily: values, total };
  }

  return {
    thisWeek: seven(weekStart),
    lastWeek: seven(prevWeekStart),
  };
}

/**
 * Gross Sales for `dateKey` read straight from the orders, not from a report.
 *
 * Square's Sales reports only recognise an order once it is paid, so a day
 * still being traded reads low all service and only catches up afterwards.
 * The owner dashboard has always answered "today" from the orders instead,
 * which is why the two screens disagreed during service; this is the same
 * arithmetic, so the week card now moves when a table orders rather than
 * when it pays.
 *
 * OPEN and COMPLETED both count — a ticket the floor has not cleared yet is
 * money that has been ordered. Refunds inside the same window come off, and
 * the window is Square's 9am–10pm sales day so the figure lines up with the
 * Reporting numbers on the days either side of it.
 */
export async function fetchDayOrderGross(
  locationId: string,
  timezone: string,
  dateKey: string,
): Promise<number> {
  const { startAt, endAt } = getSalesDayRange(timezone, dateKey);
  const [orders, refunds] = await Promise.all([
    fetchOrders(locationId, startAt, endAt, ["OPEN", "COMPLETED"]),
    sumRefundCentsByService(locationId, startAt, endAt, timezone),
  ]);
  const cents =
    orders.reduce((sum, o) => sum + squareGrossSalesCents(o), 0) -
    (refunds.lunch + refunds.dinner);
  return Math.max(0, Math.round(cents)) / 100;
}

/** Pull Gross Sales for a week from Square and write sales_weekly_daily. */
export async function warmWeekSalesCache(weekStart: string): Promise<number> {
  const { locationId, timezone, accessToken } = squareEnv;
  if (!locationId || !accessToken) return 0;

  const pair = await computeWeekPair(locationId, timezone, weekStart);
  const total = pair.thisWeek.total;
  if (total <= 0) return 0;

  adminDb()
    .collection("sales_weekly_daily")
    .doc(weekStart)
    .set(
      {
        weekStart,
        thisWeek: pair.thisWeek,
        lastWeek: pair.lastWeek,
        computeVersion: WEEKLY_DAILY_COMPUTE_VERSION,
        source: "square_reporting_gross_au",
        computedAt: Timestamp.now(),
      },
      { merge: true },
    )
    .catch((err) => console.warn("[square-weekly-daily] cache write failed:", err));

  return total;
}
