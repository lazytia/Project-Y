import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import {
  fetchOrders,
  getSalesDayRange,
  squareEnv,
  squareGrossSalesCents,
  sumRefundCents,
} from "@/lib/square";

/**
 * GET /api/square/yearly-sales?year=YYYY
 *
 * Returns monthly Gross Sales totals for the main restaurant location only
 * (Platter / catering location is excluded). Matches Square Web Sales Summary
 * by summing line-item grossSalesMoney per 9am–10pm business day and
 * subtracting refunds posted in the same window — same method as
 * /api/square/sync and sales_daily backfill.
 */

export const dynamic = "force-dynamic";

const YEAR_RE = /^\d{4}$/;
const ORDER_STATES = ["OPEN", "COMPLETED"];
/** Bump when aggregation logic changes so stale Firestore cache is ignored. */
const COMPUTE_VERSION = 2;
const DAY_BATCH = 14;

/** Current-year totals go stale as the day progresses; refresh at most
 *  every 30 minutes. Past years are historical and cached indefinitely. */
const CURRENT_YEAR_TTL_MS = 30 * 60 * 1000;
const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600",
} as const;

type CachedYear = {
  year: string;
  monthly: number[];
  total: number;
  computedAt?: Timestamp;
  computeVersion?: number;
};

/** Guard against firing multiple background refreshes for the same year. */
const inFlightRefresh = new Map<string, Promise<void>>();

function dateRange(startKey: string, endKey: string): string[] {
  const keys: string[] = [];
  const [sy, sm, sd] = startKey.split("-").map(Number);
  const cur = new Date(Date.UTC(sy, sm - 1, sd));
  const [ey, em, ed] = endKey.split("-").map(Number);
  const end = new Date(Date.UTC(ey, em - 1, ed));
  while (cur <= end) {
    keys.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return keys;
}

async function loadDailyFromFirestore(year: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const snap = await adminDb()
      .collection("sales_daily")
      .where("dateISO", ">=", `${year}-01-01`)
      .where("dateISO", "<=", `${year}-12-31`)
      .get();
    for (const doc of snap.docs) {
      const data = doc.data();
      const dateISO = data.dateISO;
      const gross = data.grossSales;
      if (typeof dateISO === "string" && typeof gross === "number" && gross > 0) {
        out.set(dateISO, gross);
      }
    }
  } catch (err) {
    console.warn("[yearly-sales] sales_daily read failed:", err);
  }
  return out;
}

async function computeDayNetCents(
  locationId: string,
  timezone: string,
  dayKey: string,
): Promise<number> {
  const { startAt, endAt } = getSalesDayRange(timezone, dayKey);
  const [orders, refunds] = await Promise.all([
    fetchOrders(locationId, startAt, endAt, ORDER_STATES),
    sumRefundCents(locationId, startAt, endAt),
  ]);
  let grossCents = 0;
  for (const o of orders) grossCents += squareGrossSalesCents(o);
  return Math.max(0, grossCents - refunds);
}

/** Compute Square-side totals for `year` and write the result to Firestore. */
async function computeAndCache(year: string): Promise<CachedYear> {
  const { locationId, timezone } = squareEnv;
  if (!locationId) throw new Error("locationId missing");

  const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: timezone });
  const days = dateRange(`${year}-01-01`, `${year}-12-31`).filter((dk) => dk <= todayKey);
  const dailyCache = await loadDailyFromFirestore(year);

  const monthlyCents = new Array(12).fill(0);
  for (let i = 0; i < days.length; i += DAY_BATCH) {
    const chunk = days.slice(i, i + DAY_BATCH);
    const nets = await Promise.all(
      chunk.map(async (dayKey) => {
        const cached = dailyCache.get(dayKey);
        if (typeof cached === "number") return Math.round(cached * 100);
        return computeDayNetCents(locationId, timezone, dayKey);
      }),
    );
    chunk.forEach((dayKey, j) => {
      const monthIdx = Number(dayKey.slice(5, 7)) - 1;
      monthlyCents[monthIdx] += nets[j];
    });
  }

  const monthlyDollars = monthlyCents.map((cents) => Math.round(cents) / 100);
  const total = Math.round(monthlyDollars.reduce((s, v) => s + v, 0) * 100) / 100;

  const result: CachedYear = {
    year,
    monthly: monthlyDollars,
    total,
    computeVersion: COMPUTE_VERSION,
  };

  await adminDb()
    .collection("sales_yearly")
    .doc(year)
    .set({ ...result, computedAt: Timestamp.now() }, { merge: true });

  return result;
}

async function refreshInBackground(year: string): Promise<void> {
  if (inFlightRefresh.has(year)) return inFlightRefresh.get(year)!;
  const p = (async () => {
    try {
      await computeAndCache(year);
    } finally {
      inFlightRefresh.delete(year);
    }
  })();
  inFlightRefresh.set(year, p);
  return p;
}

function cacheIsFresh(cached: CachedYear, isPastYear: boolean): boolean {
  if (cached.computeVersion !== COMPUTE_VERSION) return false;
  if (isPastYear) return true;
  const computedAt = cached.computedAt?.toDate?.() ?? null;
  return !!computedAt && Date.now() - computedAt.getTime() < CURRENT_YEAR_TTL_MS;
}

export async function GET(req: NextRequest) {
  const { locationId, timezone, accessToken } = squareEnv;
  if (!locationId || !accessToken) {
    return NextResponse.json({ error: "Square not configured" }, { status: 500 });
  }

  const year = req.nextUrl.searchParams.get("year");
  if (!year || !YEAR_RE.test(year)) {
    return NextResponse.json({ error: "year=YYYY required" }, { status: 400 });
  }

  const currentYear = new Date().getFullYear();
  const isPastYear = Number(year) < currentYear;
  let staleForBackgroundRefresh = false;

  try {
    const snap = await adminDb().collection("sales_yearly").doc(year).get();
    if (snap.exists) {
      const cachedData = snap.data() as CachedYear | undefined;
      const fresh = cachedData ? cacheIsFresh(cachedData, isPastYear) : false;
      if (cachedData?.monthly && Array.isArray(cachedData.monthly) && fresh) {
        return NextResponse.json(
          {
            year,
            monthly: cachedData.monthly,
            total: cachedData.total ?? 0,
            cached: true,
            stale: false,
          },
          { headers: CACHE_HEADERS },
        );
      }
      if (cachedData?.monthly && !fresh && isPastYear) {
        // Past-year cache with old logic — recompute synchronously once.
      } else if (cachedData?.monthly && !fresh) {
        staleForBackgroundRefresh = true;
        void refreshInBackground(year).catch((err) =>
          console.warn("[yearly-sales] background refresh failed:", err),
        );
        return NextResponse.json(
          {
            year,
            monthly: cachedData.monthly,
            total: cachedData.total ?? 0,
            cached: true,
            stale: true,
          },
          { headers: CACHE_HEADERS },
        );
      }
    }
  } catch (err) {
    console.warn("[yearly-sales] cache read failed:", err);
  }

  try {
    const result = await computeAndCache(year);
    return NextResponse.json(
      { ...result, cached: false, stale: staleForBackgroundRefresh },
      { headers: CACHE_HEADERS },
    );
  } catch (err) {
    console.error("[Square] yearly-sales error:", err);
    return NextResponse.json({ error: "Failed to fetch Square data" }, { status: 502 });
  }
}
