import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { fetchSupplierWeeks, type WeeklySuppliers } from "@/lib/suppliers-sheet";
import { loadWeekSalesResolved } from "@/lib/week-sales";
import { shiftDateKey } from "@/lib/square";

/**
 * GET /api/money/purchasing-cost/summary?weekStart=YYYY-MM-DD
 *
 * Powers /money/purchasing-cost. Returns the selected Mon–Sun week of
 * supplier spend from the shared Google Sheet alongside the week before it,
 * joined with matching Sydney-week Gross Sales so the
 * "% of sales" gauge is meaningful. Each week's sheet parse is cached in
 * `suppliers_week_cache/{weekStart}` so scrubbing week-to-week is instant
 * after the first hit.
 */

export const dynamic = "force-dynamic";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIMEZONE = "Australia/Sydney";

/** House goal for supplier spend as a share of sales. */
const TARGET_PCT_OF_SALES = 25;

/** Bump when the weekly sheet parse changes so stale cache is ignored. */
const PARSE_VERSION = 1;

/** Finished weeks never change; the running week keeps taking new entries. */
const PAST_TTL_MS = 24 * 60 * 60 * 1000;
const CURRENT_TTL_MS = 15 * 60 * 1000;

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=1800",
} as const;

type CachedWeek = {
  detail: WeeklySuppliers;
  computedAt?: Timestamp;
  parseVersion?: number;
};

type WeekView = {
  weekStart: string;
  weekEnd: string;
  total: number;
  activeSuppliers: number;
  suppliers: { name: string; cost: number; pctOfTotal: number }[];
};

function todayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TIMEZONE });
}

function isEmptyWeek(w: WeeklySuppliers | null | undefined): boolean {
  if (!w) return true;
  return (w.total ?? 0) <= 0 && w.suppliers.length === 0;
}

async function loadWeeksBatch(weekStarts: string[]): Promise<(WeeklySuppliers | null)[]> {
  if (weekStarts.length === 0) return [];
  const now = Date.now();
  const today = todayKey();
  const out: (WeeklySuppliers | null)[] = weekStarts.map(() => null);

  try {
    const db = adminDb();
    const refs = weekStarts.map((ws) => db.collection("suppliers_week_cache").doc(ws));
    const snaps = await db.getAll(...refs);
    snaps.forEach((snap, i) => {
      if (!snap.exists) return;
      const data = snap.data() as CachedWeek | undefined;
      const computedAt = data?.computedAt?.toDate?.() ?? null;
      if (!data?.detail || data.parseVersion !== PARSE_VERSION || isEmptyWeek(data.detail)) return;
      if (!computedAt) return;
      const ttl = shiftDateKey(weekStarts[i], 6, TIMEZONE) < today ? PAST_TTL_MS : CURRENT_TTL_MS;
      if (now - computedAt.getTime() < ttl) out[i] = data.detail;
    });
  } catch (err) {
    console.warn("[purchasing-cost/summary] cache batch read failed", err);
  }

  const missing = weekStarts.filter((_, i) => out[i] === null);
  if (missing.length === 0) return out;

  const batch = await fetchSupplierWeeks(missing).catch((err) => {
    console.warn("[purchasing-cost/summary] workbook fetch failed:", err);
    return null;
  });

  return weekStarts.map((ws, i) => {
    if (out[i]) return out[i];
    const fromSheet = batch?.get(ws) ?? null;
    if (isEmptyWeek(fromSheet)) return null;
    adminDb()
      .collection("suppliers_week_cache")
      .doc(ws)
      .set(
        { detail: fromSheet!, computedAt: Timestamp.now(), parseVersion: PARSE_VERSION },
        { merge: true },
      )
      .catch((err) => console.warn("[purchasing-cost/summary] cache write failed", err));
    return fromSheet;
  });
}

function toView(weekStart: string, week: WeeklySuppliers | null): WeekView {
  const total = week?.total ?? 0;
  const suppliers = (week?.suppliers ?? [])
    .filter((s) => s.cost > 0)
    .sort((a, b) => b.cost - a.cost)
    .map((s) => ({
      name: s.name.trim(),
      cost: s.cost,
      pctOfTotal: total > 0 ? Math.round((s.cost / total) * 1000) / 10 : 0,
    }));
  return {
    weekStart,
    weekEnd: week?.weekEnd ?? shiftDateKey(weekStart, 6, TIMEZONE),
    total,
    activeSuppliers: suppliers.length,
    suppliers,
  };
}

function pctOfSales(cost: number, sales: number): number | null {
  return sales > 0 ? Math.round((cost / sales) * 1000) / 10 : null;
}

export async function GET(req: NextRequest) {
  const weekStart = req.nextUrl.searchParams.get("weekStart");
  if (!weekStart || !DATE_KEY_RE.test(weekStart)) {
    return NextResponse.json({ error: "weekStart=YYYY-MM-DD required" }, { status: 400 });
  }

  const previousWeek = shiftDateKey(weekStart, -7, TIMEZONE);

  try {
    const [weeks, sales] = await Promise.all([
      loadWeeksBatch([weekStart, previousWeek]),
      loadWeekSalesResolved([weekStart, previousWeek]),
    ]);

    const current = toView(weekStart, weeks[0]);
    const previous = toView(previousWeek, weeks[1]);

    return NextResponse.json(
      {
        weekStart,
        weekEnd: current.weekEnd,
        current,
        previous,
        sales: { current: sales[0], previous: sales[1] },
        costPctSales: pctOfSales(current.total, sales[0]),
        costPctSalesPrev: pctOfSales(previous.total, sales[1]),
        target: TARGET_PCT_OF_SALES,
      },
      { headers: CACHE_HEADERS },
    );
  } catch (err) {
    console.error("[purchasing-cost/summary] error:", err);
    return NextResponse.json({ error: "Failed to build supplier cost summary" }, { status: 502 });
  }
}
