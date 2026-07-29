import { adminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { fetchDailyGrossSalesFromReporting } from "@/lib/square-reporting";
import { shiftDateKey, squareEnv } from "@/lib/square";

/** Bump when gross-sales formula or data source changes. */
export const WEEKLY_DAILY_COMPUTE_VERSION = 2;

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
