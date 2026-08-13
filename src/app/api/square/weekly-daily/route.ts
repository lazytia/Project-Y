import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import {
  computeWeekPair,
  fetchOpenOrderGross,
  weekCacheIsSettled,
  WEEKLY_DAILY_COMPUTE_VERSION,
} from "@/lib/square-weekly-daily";
import { shiftDateKey, squareEnv } from "@/lib/square";

/**
 * GET /api/square/weekly-daily?weekStart=YYYY-MM-DD
 *
 * Returns 7 daily Gross Sales totals (Mon–Sun) for the given week AND for
 * the immediately preceding week from Square Reporting API (Sales Summary
 * Gross sales = net sales + taxes). Powers /money/sales weekly chart.
 *
 * Today additionally carries the value of orders that are still open, so the
 * running total moves the moment a table orders rather than when it pays.
 */

export const dynamic = "force-dynamic";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Past weeks never change — cache them forever. The week that contains
 *  today refreshes every 10 minutes so the running total stays live. */
const CURRENT_WEEK_TTL_MS = 10 * 60 * 1000;

const CACHE_HEADERS = {
  // Fresh for 5 min, up to 30 min stale-while-revalidate. Perfect for
  // an owner scrubbing through a few weeks in a row.
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=1800",
} as const;

/** The current week carries live open tickets — never serve it from a CDN. */
const LIVE_HEADERS = { "Cache-Control": "no-store" } as const;

type CachedWeekPair = {
  weekStart: string;
  thisWeek: { daily: number[]; total: number };
  lastWeek: { daily: number[]; total: number };
  computedAt?: Timestamp;
  computeVersion?: number;
};

function todaySydneyKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
}

/** Day offset (0 = Monday) of `dateKey` within the week, or -1 if outside it. */
function dayOffsetInWeek(weekStart: string, dateKey: string): number {
  const days = Math.round(
    (Date.parse(`${dateKey}T00:00:00Z`) - Date.parse(`${weekStart}T00:00:00Z`)) / 86_400_000,
  );
  return days >= 0 && days <= 6 ? days : -1;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Add today's unpaid open tickets onto the running week. Kept out of the
 * Firestore cache on purpose: the cached document stays a clean Reporting
 * snapshot, and the live open amount is folded in on every request.
 */
async function withOpenOrders(
  pair: Pick<CachedWeekPair, "thisWeek" | "lastWeek">,
  weekStart: string,
  today: string,
  locationId: string,
  timezone: string,
): Promise<Pick<CachedWeekPair, "thisWeek" | "lastWeek">> {
  const offset = dayOffsetInWeek(weekStart, today);
  if (offset < 0) return pair;

  const openGross = await fetchOpenOrderGross(locationId, timezone, today).catch((err) => {
    console.warn("[weekly-daily] open order lookup failed:", err);
    return 0;
  });
  if (openGross <= 0) return pair;

  const daily = [...pair.thisWeek.daily];
  daily[offset] = round2((daily[offset] ?? 0) + openGross);
  return {
    ...pair,
    thisWeek: { daily, total: round2(pair.thisWeek.total + openGross) },
  };
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

  const today = todaySydneyKey();
  const weekEnd = shiftDateKey(weekStart, 6, timezone);
  const isPastWeek = weekEnd < today;

  // Firestore write-through cache — instant on repeat hits.
  const cacheDocId = weekStart;
  try {
    const snap = await adminDb().collection("sales_weekly_daily").doc(cacheDocId).get();
    if (snap.exists) {
      const data = snap.data() as CachedWeekPair | undefined;
      const computedAt = data?.computedAt?.toDate?.() ?? null;
      const fresh =
        data?.computeVersion === WEEKLY_DAILY_COMPUTE_VERSION &&
        (isPastWeek
          ? weekCacheIsSettled(weekStart, computedAt, timezone)
          : computedAt !== null && Date.now() - computedAt.getTime() < CURRENT_WEEK_TTL_MS);
      if (fresh && data?.thisWeek && data?.lastWeek) {
        const live = await withOpenOrders(
          { thisWeek: data.thisWeek, lastWeek: data.lastWeek },
          weekStart,
          today,
          locationId,
          timezone,
        );
        return NextResponse.json(
          { weekStart, ...live, cached: true },
          { headers: isPastWeek ? CACHE_HEADERS : LIVE_HEADERS },
        );
      }
    }
  } catch (err) {
    console.warn("[weekly-daily] cache read failed:", err);
  }

  try {
    const pair = await computeWeekPair(locationId, timezone, weekStart);

    adminDb()
      .collection("sales_weekly_daily")
      .doc(cacheDocId)
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
      .catch((err) => console.warn("[weekly-daily] cache write failed:", err));

    const live = await withOpenOrders(pair, weekStart, today, locationId, timezone);
    return NextResponse.json(
      { weekStart, ...live },
      { headers: isPastWeek ? CACHE_HEADERS : LIVE_HEADERS },
    );
  } catch (err) {
    console.error("[Square] weekly-daily error:", err);
    return NextResponse.json({ error: "Failed to fetch Square data" }, { status: 502 });
  }
}
