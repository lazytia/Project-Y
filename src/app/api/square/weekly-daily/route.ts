import { NextRequest, NextResponse } from "next/server";
import {
  fetchOrders,
  getSalesDayRange,
  shiftDateKey,
  squareEnv,
  squareGrossSalesCents,
  sumRefundCents,
} from "@/lib/square";

/**
 * GET /api/square/weekly-daily?weekStart=YYYY-MM-DD
 *
 * Returns 7 daily Gross Sales totals (Mon–Sun) for the given week AND for
 * the immediately preceding week, matching Square Web's dashboard figures.
 * Powers the "This Week vs Last Week" chart on /money/sales so the numbers
 * come from Square rather than the potentially-stale Firestore cache.
 */

export const dynamic = "force-dynamic";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ORDER_STATES = ["OPEN", "COMPLETED"];

const CACHE_HEADERS = {
  // Fresh for 5 min, up to 30 min stale-while-revalidate. Perfect for
  // an owner scrubbing through a few weeks in a row.
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=1800",
} as const;

async function daySalesCents(
  locationId: string,
  timezone: string,
  dayKey: string,
): Promise<number> {
  const { startAt, endAt } = getSalesDayRange(timezone, dayKey);
  const [orders, refundsCents] = await Promise.all([
    fetchOrders(locationId, startAt, endAt, ORDER_STATES),
    sumRefundCents(locationId, startAt, endAt),
  ]);
  let gross = 0;
  for (const o of orders) {
    if (o.state !== "COMPLETED") continue;
    gross += squareGrossSalesCents(o);
  }
  return gross - refundsCents;
}

async function weekTotals(
  locationId: string,
  timezone: string,
  mondayKey: string,
): Promise<{ daily: number[]; total: number }> {
  const days: string[] = [];
  for (let i = 0; i < 7; i++) days.push(shiftDateKey(mondayKey, i, timezone));
  const cents = await Promise.all(days.map((d) => daySalesCents(locationId, timezone, d)));
  const dailyDollars = cents.map((c) => Math.round(c) / 100);
  const total = Math.round(dailyDollars.reduce((s, v) => s + v, 0) * 100) / 100;
  return { daily: dailyDollars, total };
}

export async function GET(req: NextRequest) {
  const { locationId, timezone, accessToken } = squareEnv;
  if (!locationId || !accessToken) {
    return NextResponse.json({ error: "Square not configured" }, { status: 500 });
  }

  const weekStart = req.nextUrl.searchParams.get("weekStart");
  if (!weekStart || !DATE_KEY_RE.test(weekStart)) {
    return NextResponse.json({ error: "weekStart=YYYY-MM-DD required" }, { status: 400 });
  }

  try {
    const prevWeekStart = shiftDateKey(weekStart, -7, timezone);
    const [thisWeek, lastWeek] = await Promise.all([
      weekTotals(locationId, timezone, weekStart),
      weekTotals(locationId, timezone, prevWeekStart),
    ]);

    return NextResponse.json(
      {
        weekStart,
        thisWeek,
        lastWeek,
      },
      { headers: CACHE_HEADERS },
    );
  } catch (err) {
    console.error("[Square] weekly-daily error:", err);
    return NextResponse.json({ error: "Failed to fetch Square data" }, { status: 502 });
  }
}
