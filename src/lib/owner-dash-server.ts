import { adminDb } from "@/lib/firebase-admin";
import { fetchSystemYuricaTodayCounts } from "@/lib/system-yurica";
import { addDaysISO, isoMondayOf, sydneyTodayKey } from "@/lib/sydney-date";
import type { DashCache } from "@/lib/owner-dash-cache";

export type OwnerDashServerSnapshot = {
  dateKey: string;
  cache: DashCache;
};

/** Server-side owner dashboard snapshot — paints before client Firebase auth. */
export async function prefetchOwnerDash(
  dateKey = sydneyTodayKey(),
): Promise<OwnerDashServerSnapshot> {
  const weekMonday = isoMondayOf(dateKey);
  const prevMonday = addDaysISO(weekMonday, -7);
  const db = adminDb();

  const [
    dailySnap,
    weekSnap,
    prevWeekSnap,
    payrollSnap,
    reviewSnap,
    rosterSnap,
    todayCounts,
  ] = await Promise.all([
    db.collection("sales_daily").doc(dateKey).get(),
    db.collection("sales_weekly").doc(weekMonday).get(),
    db.collection("sales_weekly").doc(prevMonday).get(),
    db.collection("payroll_weekly").doc(weekMonday).get(),
    db.collection("sales_reviews").doc(dateKey).get(),
    db.collection("rosters_published").doc(weekMonday).get(),
    fetchSystemYuricaTodayCounts(dateKey).catch(() => null),
  ]);

  const cache: DashCache = { cachedAt: Date.now() };

  const daily = dailySnap.exists ? dailySnap.data() : null;
  if (typeof daily?.grossSales === "number") {
    cache.savedDaySales = daily.grossSales;
    cache.todaySales = daily.grossSales;
  }

  const week = weekSnap.exists ? weekSnap.data() : null;
  if (typeof week?.totalSales === "number") cache.weekSalesDoc = week.totalSales;
  else if (typeof week?.grossSales === "number") cache.weekSalesDoc = week.grossSales;

  const prevWeek = prevWeekSnap.exists ? prevWeekSnap.data() : null;
  if (typeof prevWeek?.totalSales === "number") cache.prevWeekSales = prevWeek.totalSales;
  else if (typeof prevWeek?.grossSales === "number") cache.prevWeekSales = prevWeek.grossSales;

  const payroll = payrollSnap.exists ? payrollSnap.data() : null;
  if (payroll) {
    const total =
      typeof payroll.totalIncSuper === "number"
        ? payroll.totalIncSuper
        : (typeof payroll.gross === "number" ? payroll.gross : 0) +
          (typeof payroll.super === "number" ? payroll.super : 0);
    if (total) cache.weeklyPayroll = total;
  }

  const review = reviewSnap.exists ? reviewSnap.data() : null;
  if (typeof review?.text === "string") cache.reviewNote = review.text;

  if (rosterSnap.exists) {
    const assignments = rosterSnap.data()?.assignments as
      | Record<string, Record<string, Record<string, string>>>
      | undefined;
    const dayAssign = assignments?.[dateKey] ?? {};
    const lunch = new Set<string>();
    const dinner = new Set<string>();
    for (const [meal, uids] of Object.entries(dayAssign)) {
      const set = meal.toLowerCase().includes("dinner") ? dinner : lunch;
      for (const uid of Object.keys(uids)) set.add(uid);
    }
    cache.lunchStaff = lunch.size;
    cache.dinnerStaff = dinner.size;
  }

  if (todayCounts) {
    cache.lunchPax = todayCounts.lunchPax;
    cache.dinnerPax = todayCounts.dinnerPax;
    if (cache.lunchStaff == null) cache.lunchStaff = todayCounts.lunchStaff;
    if (cache.dinnerStaff == null) cache.dinnerStaff = todayCounts.dinnerStaff;
  }

  return { dateKey, cache };
}
