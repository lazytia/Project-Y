import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { fetchSupplierMonths, type MonthlySuppliers } from "@/lib/suppliers-sheet";

/**
 * GET /api/money/suppliers/summary?month=YYYY-MM
 *
 * Powers /money/suppliers. Pulls the current month + 5 prior months of
 * supplier costs from the shared Google Sheet, joins on matching Sydney
 * monthly Gross Sales from Firestore sales_daily, and computes % of
 * sales / vs-previous-month deltas. Each month's sheet parse is cached
 * in `suppliers_month_cache/{yyyy-mm}` so scrubbing month-to-month is
 * instant after the first hit.
 */

export const dynamic = "force-dynamic";

const MONTH_RE = /^\d{4}-\d{2}$/;
const TIMEZONE = "Australia/Sydney";

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=1800",
} as const;

type CachedMonth = {
  detail: MonthlySuppliers;
  computedAt?: Timestamp;
};

/** Past months are historical; today's month goes stale as new purchases
 *  are entered on-sheet, so refresh at most every 15 minutes. */
const PAST_TTL_MS = 24 * 60 * 60 * 1000;
const CURRENT_TTL_MS = 15 * 60 * 1000;

function shiftMonth(monthISO: string, delta: number): string {
  const [y, m] = monthISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(monthISO: string): string {
  const [y, m] = monthISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-AU", {
    month: "short",
    timeZone: "UTC",
  });
}

function currentMonthKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TIMEZONE }).slice(0, 7);
}

function isEmptyMonth(m: MonthlySuppliers | null | undefined): boolean {
  if (!m) return true;
  return (m.total ?? 0) <= 0 && m.suppliers.length === 0;
}

async function loadMonth(
  monthISO: string,
  batch: Map<string, MonthlySuppliers | null> | null,
): Promise<MonthlySuppliers | null> {
  const isPast = monthISO < currentMonthKey();

  if (batch?.has(monthISO)) {
    const fromSheet = batch.get(monthISO) ?? null;
    if (!isEmptyMonth(fromSheet)) {
      adminDb()
        .collection("suppliers_month_cache")
        .doc(monthISO)
        .set({ detail: fromSheet!, computedAt: Timestamp.now() }, { merge: true })
        .catch((err) => console.warn("[suppliers/summary] cache write failed", err));
      return fromSheet;
    }
  }

  try {
    const snap = await adminDb().collection("suppliers_month_cache").doc(monthISO).get();
    if (snap.exists) {
      const data = snap.data() as CachedMonth | undefined;
      const computedAt = data?.computedAt?.toDate?.() ?? null;
      const ttl = isPast ? PAST_TTL_MS : CURRENT_TTL_MS;
      if (data?.detail && !isEmptyMonth(data.detail) && computedAt && Date.now() - computedAt.getTime() < ttl) {
        return data.detail;
      }
    }
  } catch (err) {
    console.warn("[suppliers/summary] cache read failed", monthISO, err);
  }

  if (batch?.has(monthISO)) {
    return batch.get(monthISO) ?? null;
  }

  return null;
}

async function monthsCacheWarm(monthKeys: string[]): Promise<boolean> {
  const now = Date.now();
  const current = currentMonthKey();
  try {
    const snaps = await Promise.all(
      monthKeys.map((mk) => adminDb().collection("suppliers_month_cache").doc(mk).get()),
    );
    return snaps.every((snap, i) => {
      const mk = monthKeys[i];
      if (!snap.exists) return false;
      const data = snap.data() as CachedMonth | undefined;
      const computedAt = data?.computedAt?.toDate?.() ?? null;
      const ttl = mk < current ? PAST_TTL_MS : CURRENT_TTL_MS;
      return (
        !!data?.detail &&
        !isEmptyMonth(data.detail) &&
        !!computedAt &&
        now - computedAt.getTime() < ttl
      );
    });
  } catch (err) {
    console.warn("[suppliers/summary] cache warm check failed", err);
    return false;
  }
}

/** One Firestore read for the whole trend window instead of six. */
async function loadSalesByMonths(monthKeys: string[]): Promise<number[]> {
  if (monthKeys.length === 0) return [];
  const first = monthKeys[0];
  const [ly, lm] = monthKeys[monthKeys.length - 1].split("-").map(Number);
  const startISO = `${first}-01`;
  const endISO = new Date(Date.UTC(ly, lm, 1)).toISOString().slice(0, 10);
  const totals = new Map(monthKeys.map((mk) => [mk, 0]));
  try {
    const snap = await adminDb()
      .collection("sales_daily")
      .where("dateISO", ">=", startISO)
      .where("dateISO", "<", endISO)
      .get();
    snap.docs.forEach((d) => {
      const dateISO = d.data().dateISO;
      if (typeof dateISO !== "string") return;
      const mk = dateISO.slice(0, 7);
      if (!totals.has(mk)) return;
      const v = d.data().grossSales;
      if (typeof v === "number") totals.set(mk, (totals.get(mk) ?? 0) + v);
    });
  } catch (err) {
    console.warn("[suppliers/summary] sales range read failed", err);
  }
  return monthKeys.map((mk) => Math.round((totals.get(mk) ?? 0) * 100) / 100);
}

function totalOf(m: MonthlySuppliers | null): number {
  if (!m) return 0;
  if (typeof m.total === "number" && m.total > 0) return m.total;
  return Math.round(m.suppliers.reduce((s, r) => s + (r.cost ?? 0), 0) * 100) / 100;
}

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get("month");
  if (!month || !MONTH_RE.test(month)) {
    return NextResponse.json({ error: "month=YYYY-MM required" }, { status: 400 });
  }

  try {
    // Six-month trend window: current month + 5 prior.
    const monthKeys: string[] = [];
    for (let i = 5; i >= 0; i--) monthKeys.push(shiftMonth(month, -i));

    const cacheWarm = await monthsCacheWarm(monthKeys);
    const batch = cacheWarm
      ? null
      : await fetchSupplierMonths(monthKeys).catch((err) => {
          console.warn("[suppliers/summary] workbook fetch failed:", err);
          return null;
        });

    const [monthData, salesData] = await Promise.all([
      Promise.all(monthKeys.map((mk) => loadMonth(mk, batch))),
      loadSalesByMonths(monthKeys),
    ]);

    const currentIdx = monthKeys.length - 1;
    const current = monthData[currentIdx];
    const prev = monthData[currentIdx - 1] ?? null;
    const prev2 = monthData[currentIdx - 2] ?? null;
    const currentSales = salesData[currentIdx] ?? 0;

    const currentTotal = totalOf(current);
    const prevTotal = totalOf(prev);
    const prev2Total = totalOf(prev2);

    const suppliersRanked = (current?.suppliers ?? [])
      .map((s) => ({ ...s, cost: Math.round(s.cost * 100) / 100 }))
      .sort((a, b) => b.cost - a.cost)
      .map((s) => ({
        name: s.name,
        cost: s.cost,
        pctOfTotal: currentTotal > 0 ? Math.round((s.cost / currentTotal) * 1000) / 10 : 0,
      }));

    const monthlyTrend = monthKeys.map((mk, i) => ({
      month: mk,
      label: monthLabel(mk),
      cost: totalOf(monthData[i]),
    }));

    // Comparison table: union of supplier names across the 3 months,
    // sorted by current-month cost desc, then last-month, then 2mo-ago.
    const nameSet = new Set<string>();
    for (const m of [current, prev, prev2]) {
      m?.suppliers?.forEach((s) => nameSet.add(s.name));
    }
    function costFor(m: MonthlySuppliers | null, name: string): number {
      const row = m?.suppliers.find((s) => s.name === name);
      return row ? Math.round(row.cost * 100) / 100 : 0;
    }
    const comparison = Array.from(nameSet)
      .map((name) => ({
        name,
        thisMonth: costFor(current, name),
        lastMonth: costFor(prev, name),
        twoMonthsAgo: costFor(prev2, name),
      }))
      .sort((a, b) => b.thisMonth - a.thisMonth || b.lastMonth - a.lastMonth);

    const costPctSales =
      currentSales > 0 ? Math.round((currentTotal / currentSales) * 1000) / 10 : null;

    // "vs May" style delta compared to the previous month.
    const vsPrev =
      prevTotal > 0
        ? Math.round(((currentTotal - prevTotal) / prevTotal) * 1000) / 10
        : null;

    // Percentage-point change of Supplier Cost % of Sales vs prev month.
    const prevCostPctSales =
      salesData[currentIdx - 1] > 0
        ? Math.round((prevTotal / salesData[currentIdx - 1]) * 1000) / 10
        : null;
    const vsPrevPctSales =
      costPctSales !== null && prevCostPctSales !== null
        ? Math.round((costPctSales - prevCostPctSales) * 10) / 10
        : null;

    return NextResponse.json(
      {
        month,
        prevMonth: shiftMonth(month, -1),
        prevMonthLabel: monthLabel(shiftMonth(month, -1)),
        currentTotal,
        prevTotal,
        prev2Total,
        currentSales,
        costPctSales,
        vsPrevPctSales,
        vsPrev,
        target: 28,
        suppliers: suppliersRanked,
        monthlyTrend,
        comparison,
      },
      { headers: CACHE_HEADERS },
    );
  } catch (err) {
    console.error("[suppliers/summary] error:", err);
    return NextResponse.json({ error: "Failed to build supplier summary" }, { status: 502 });
  }
}

