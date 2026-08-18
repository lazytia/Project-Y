import { adminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { fetchDailyGrossSalesFromReporting } from "@/lib/square-reporting";
import {
  fetchOrders,
  getDateRange,
  shiftDateKey,
  squareEnv,
  squareGrossSalesCents,
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
 * Gross value of tickets opened on `dateKey` that nobody has paid for yet.
 *
 * Square's Sales reports only recognise an order once it is paid, so open tabs
 * would otherwise leave the week-to-date figure flat. The floor leaves tickets
 * OPEN until the table is cleared, long after they are tendered, so the OPEN
 * state alone is not a proxy for "Reporting has not seen it" — counting those
 * double-counted them on top of the Reporting total.
 */
export async function fetchOpenOrderGross(
  locationId: string,
  timezone: string,
  dateKey: string,
): Promise<number> {
  const { startAt, endAt } = getDateRange(timezone, 0, dateKey);
  const orders = await fetchOrders(locationId, startAt, endAt, ["OPEN"]);
  const cents = orders
    .filter((o) => (o.tenders ?? []).length === 0)
    .reduce((sum, o) => sum + squareGrossSalesCents(o), 0);
  return Math.round(cents) / 100;
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
