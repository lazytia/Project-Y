import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { fetchYearlyGrossSalesFromReporting } from "@/lib/square-reporting";
import { squareEnv } from "@/lib/square";

/**
 * GET /api/square/yearly-sales?year=YYYY
 *
 * Monthly gross sales from Square Reporting API (Sales Summary
 * "Gross sales" = net sales + taxes). Main location only; Platter excluded.
 */

export const dynamic = "force-dynamic";

const YEAR_RE = /^\d{4}$/;
/** Bump when data source or query shape changes. */
const COMPUTE_VERSION = 5;

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
  source?: string;
};

const inFlightRefresh = new Map<string, Promise<void>>();

async function computeAndCache(year: string): Promise<CachedYear> {
  const { locationId } = squareEnv;
  if (!locationId) throw new Error("locationId missing");

  const { monthly, total } = await fetchYearlyGrossSalesFromReporting(year, locationId);

  const result: CachedYear = {
    year,
    monthly,
    total,
    computeVersion: COMPUTE_VERSION,
    source: "square_reporting_gross_au",
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
  const { locationId, accessToken } = squareEnv;
  if (!locationId || !accessToken) {
    return NextResponse.json({ error: "Square not configured" }, { status: 500 });
  }

  const year = req.nextUrl.searchParams.get("year");
  if (!year || !YEAR_RE.test(year)) {
    return NextResponse.json({ error: "year=YYYY required" }, { status: 400 });
  }

  const currentYear = new Date().getFullYear();
  const isPastYear = Number(year) < currentYear;

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
            source: cachedData.source ?? "square_reporting_gross_au",
          },
          { headers: CACHE_HEADERS },
        );
      }
      if (cachedData?.monthly && !fresh && !isPastYear) {
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
            source: cachedData.source,
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
      { ...result, cached: false, stale: false },
      { headers: CACHE_HEADERS },
    );
  } catch (err) {
    console.error("[Square] yearly-sales error:", err);
    const msg = err instanceof Error ? err.message : "Failed to fetch Square data";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
