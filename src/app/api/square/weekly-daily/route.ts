import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import {
  fetchOrders,
  getSalesDayRange,
  shiftDateKey,
  squareClient,
  squareEnv,
  squareGrossSalesCents,
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

/** Past weeks never change — cache them forever. The week that contains
 *  today refreshes every 10 minutes so the running total stays live. */
const CURRENT_WEEK_TTL_MS = 10 * 60 * 1000;

const CACHE_HEADERS = {
  // Fresh for 5 min, up to 30 min stale-while-revalidate. Perfect for
  // an owner scrubbing through a few weeks in a row.
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=1800",
} as const;

type CachedWeekPair = {
  weekStart: string;
  thisWeek: { daily: number[]; total: number };
  lastWeek: { daily: number[]; total: number };
  computedAt?: Timestamp;
};

type Refund = {
  createdAt?: string;
  amountMoney?: { amount?: bigint };
};

/** All refunds inside [startAt, endAt) — one paginated walk instead of
 *  one per day. Uses Square's async-iterator surface so pagination is
 *  handled for us. */
async function fetchRefunds(
  locationId: string,
  startAt: string,
  endAt: string,
): Promise<Refund[]> {
  const refunds: Refund[] = [];
  const iter = await squareClient.refunds.list({
    locationId,
    beginTime: startAt,
    endTime: endAt,
    limit: 100,
    sortField: "CREATED_AT",
  });
  for await (const r of iter) refunds.push(r as Refund);
  return refunds;
}

/** Split a UTC ISO instant into the Sydney-local yyyy-mm-dd string so we
 *  bucket orders by the store's calendar day rather than UTC. */
function localDateKey(iso: string, timezone: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-CA", { timeZone: timezone });
}

async function computeWeekPair(
  locationId: string,
  timezone: string,
  weekStart: string,
): Promise<{
  thisWeek: { daily: number[]; total: number };
  lastWeek: { daily: number[]; total: number };
}> {
  const prevWeekStart = shiftDateKey(weekStart, -7, timezone);
  // 14-day window — first day of last week to the last day of this week.
  const startWin = getSalesDayRange(timezone, prevWeekStart);
  const endWin = getSalesDayRange(timezone, shiftDateKey(weekStart, 6, timezone));

  // Two paginated walks total (orders + refunds), regardless of week
  // count. Compare with the old code, which did 14 daily order-fetch
  // walks and 14 daily refund walks per request.
  const [orders, refunds] = await Promise.all([
    fetchOrders(locationId, startWin.startAt, endWin.endAt, ORDER_STATES),
    fetchRefunds(locationId, startWin.startAt, endWin.endAt),
  ]);

  const dayCents = new Map<string, number>();
  for (const o of orders) {
    if (o.state !== "COMPLETED") continue;
    if (!o.createdAt) continue;
    const dk = localDateKey(o.createdAt, timezone);
    dayCents.set(dk, (dayCents.get(dk) ?? 0) + squareGrossSalesCents(o));
  }
  for (const r of refunds) {
    if (!r.createdAt) continue;
    const dk = localDateKey(r.createdAt, timezone);
    const amt = Number(r.amountMoney?.amount ?? 0n);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    dayCents.set(dk, (dayCents.get(dk) ?? 0) - amt);
  }

  function seven(mondayKey: string) {
    const daily: number[] = [];
    for (let i = 0; i < 7; i++) {
      const dk = shiftDateKey(mondayKey, i, timezone);
      const cents = dayCents.get(dk) ?? 0;
      daily.push(Math.round(cents) / 100);
    }
    const total = Math.round(daily.reduce((s, v) => s + v, 0) * 100) / 100;
    return { daily, total };
  }

  return {
    thisWeek: seven(weekStart),
    lastWeek: seven(prevWeekStart),
  };
}

function todaySydneyKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
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
        isPastWeek ||
        (computedAt && Date.now() - computedAt.getTime() < CURRENT_WEEK_TTL_MS);
      if (fresh && data?.thisWeek && data?.lastWeek) {
        return NextResponse.json(
          { weekStart, thisWeek: data.thisWeek, lastWeek: data.lastWeek, cached: true },
          { headers: CACHE_HEADERS },
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
          computedAt: Timestamp.now(),
        },
        { merge: true },
      )
      .catch((err) => console.warn("[weekly-daily] cache write failed:", err));

    return NextResponse.json(
      { weekStart, ...pair },
      { headers: CACHE_HEADERS },
    );
  } catch (err) {
    console.error("[Square] weekly-daily error:", err);
    return NextResponse.json({ error: "Failed to fetch Square data" }, { status: 502 });
  }
}
