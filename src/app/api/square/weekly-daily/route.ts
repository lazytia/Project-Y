import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { computeWeekPair } from "@/lib/square-weekly-daily";
import { shiftDateKey, squareEnv } from "@/lib/square";

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
