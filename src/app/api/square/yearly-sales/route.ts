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
 * Returns monthly Gross Sales totals for the given calendar year, matching
 * Square Web's dashboard figures (line-item grossSalesMoney summed inside
 * the 9am–10pm business-day window, minus refunds posted the same window).
 * Used by /money/sales so the "This Year vs Last Year" chart works even
 * for years we haven't backfilled into Firestore's sales_daily cache.
 */

export const dynamic = "force-dynamic";

const YEAR_RE = /^\d{4}$/;
const ORDER_STATES = ["OPEN", "COMPLETED"];

/** Current-year totals go stale as the day progresses; refresh at most
 *  every 30 minutes. Past years are historical and cached indefinitely. */
const CURRENT_YEAR_TTL_MS = 30 * 60 * 1000;
const CACHE_HEADERS = {
  // 10 min fresh, up to 1 hour stale — the client/Edge can serve the
  // cached copy while background-revalidating.
  "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600",
} as const;

type CachedYear = {
  year: string;
  monthly: number[];
  total: number;
  computedAt?: Timestamp;
};

export async function GET(req: NextRequest) {
  const { locationId, timezone, accessToken } = squareEnv;
  if (!locationId || !accessToken) {
    return NextResponse.json({ error: "Square not configured" }, { status: 500 });
  }

  const year = req.nextUrl.searchParams.get("year");
  if (!year || !YEAR_RE.test(year)) {
    return NextResponse.json({ error: "year=YYYY required" }, { status: 400 });
  }

  // Firestore write-through cache — instant on repeat hits, self-refreshes
  // for the current year at CURRENT_YEAR_TTL_MS cadence.
  const currentYear = new Date().getFullYear();
  const isPastYear = Number(year) < currentYear;
  try {
    const snap = await adminDb().collection("sales_yearly").doc(year).get();
    if (snap.exists) {
      const data = snap.data() as CachedYear | undefined;
      const computedAt = data?.computedAt?.toDate?.() ?? null;
      const fresh =
        isPastYear ||
        (computedAt && Date.now() - computedAt.getTime() < CURRENT_YEAR_TTL_MS);
      if (fresh && data?.monthly && Array.isArray(data.monthly)) {
        return NextResponse.json(
          { year, monthly: data.monthly, total: data.total ?? 0, cached: true },
          { headers: CACHE_HEADERS },
        );
      }
    }
  } catch (err) {
    // Cache read failure isn't fatal — fall through to a fresh compute.
    console.warn("[yearly-sales] cache read failed:", err);
  }

  try {
    // Business-day window across the whole year: Jan 1 9am → Dec 31 10pm.
    const jan1 = getSalesDayRange(timezone, `${year}-01-01`);
    const dec31 = getSalesDayRange(timezone, `${year}-12-31`);

    // Fetch every order for the year in one paginated walk, then bucket
    // by the local month of its `createdAt`. This keeps the network cost
    // to a single walk instead of 12 monthly windows.
    const orders = await fetchOrders(locationId, jan1.startAt, dec31.endAt, ORDER_STATES);

    const monthly = new Array(12).fill(0); // gross sales cents per month
    for (const order of orders) {
      // Skip open orders (not yet finalised sales); Square Web ignores
      // them in the Sales Summary too.
      if (order.state !== "COMPLETED") continue;
      const created = order.createdAt ? new Date(order.createdAt) : null;
      if (!created || Number.isNaN(created.getTime())) continue;
      // Translate UTC createdAt to the store's local month so orders that
      // straddle midnight UTC stay in the right calendar month.
      const localMonthKey = created.toLocaleDateString("en-US", {
        timeZone: timezone,
        year: "numeric",
        month: "numeric",
      });
      const [monthStr, yearStr] = localMonthKey.split("/");
      if (yearStr !== year) continue; // window sometimes leaks a few hours
      const m = Number(monthStr) - 1;
      if (m < 0 || m > 11) continue;
      monthly[m] += squareGrossSalesCents(order);
    }

    // Refunds are trickier: their timestamp can lag the original order.
    // Query month-by-month so each month's Gross Sales is netted against
    // the refunds that actually posted in that month's business window.
    const refundResults = await Promise.all(
      Array.from({ length: 12 }, async (_, i) => {
        const monthNum = i + 1;
        const firstKey = `${year}-${String(monthNum).padStart(2, "0")}-01`;
        const nextMonth = i === 11 ? [Number(year) + 1, 1] : [Number(year), monthNum + 1];
        const nextKey = `${nextMonth[0]}-${String(nextMonth[1]).padStart(2, "0")}-01`;
        const startWin = getSalesDayRange(timezone, firstKey);
        // End of month = start of next month's business day window,
        // shifted back one microsecond so the ranges don't overlap.
        const endOfMonthWin = getSalesDayRange(timezone, nextKey);
        return sumRefundCents(locationId, startWin.startAt, endOfMonthWin.startAt);
      }),
    );

    const monthlyDollars = monthly.map((grossCents, i) => {
      const net = (grossCents - refundResults[i]) / 100;
      return Math.round(net * 100) / 100;
    });
    const total = Math.round(monthlyDollars.reduce((s, v) => s + v, 0) * 100) / 100;

    // Fire-and-forget write-through cache. Read path will pick this up
    // instantly on the next request for the same year.
    adminDb()
      .collection("sales_yearly")
      .doc(year)
      .set(
        {
          year,
          monthly: monthlyDollars,
          total,
          computedAt: Timestamp.now(),
        },
        { merge: true },
      )
      .catch((err) => console.warn("[yearly-sales] cache write failed:", err));

    return NextResponse.json(
      { year, monthly: monthlyDollars, total },
      { headers: CACHE_HEADERS },
    );
  } catch (err) {
    console.error("[Square] yearly-sales error:", err);
    return NextResponse.json({ error: "Failed to fetch Square data" }, { status: 502 });
  }
}
