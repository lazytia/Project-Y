import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";

/**
 * GET /api/money/suppliers/summary?month=YYYY-MM
 *
 * Powers /money/suppliers. Reads owner-entered supplier costs from
 * suppliers_monthly/{yyyy-mm} for the current month + 5 prior months, plus
 * the matching monthly Gross Sales totals from sales_daily so the
 * "Supplier Cost % of Sales" gauge and the vs-May chip are real figures.
 */

export const dynamic = "force-dynamic";

const MONTH_RE = /^\d{4}-\d{2}$/;
const TIMEZONE = "Australia/Sydney";

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=1800",
} as const;

type StoredSupplierRow = { name: string; cost: number };
type StoredMonth = {
  monthISO?: string;
  suppliers?: StoredSupplierRow[];
  targetPct?: number;
};

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

async function loadMonth(monthISO: string): Promise<StoredMonth | null> {
  try {
    const snap = await adminDb().collection("suppliers_monthly").doc(monthISO).get();
    return snap.exists ? (snap.data() as StoredMonth) : null;
  } catch (err) {
    console.warn("[suppliers/summary] month read failed", monthISO, err);
    return null;
  }
}

async function loadMonthSales(monthISO: string): Promise<number> {
  // Sum sales_daily.grossSales for every date within the given month.
  const [y, m] = monthISO.split("-").map(Number);
  const startISO = `${monthISO}-01`;
  const nextMonthDate = new Date(Date.UTC(y, m, 1));
  const nextMonthISO = nextMonthDate.toISOString().slice(0, 10);
  try {
    const snap = await adminDb()
      .collection("sales_daily")
      .where("dateISO", ">=", startISO)
      .where("dateISO", "<", nextMonthISO)
      .get();
    let total = 0;
    snap.docs.forEach((d) => {
      const v = d.data().grossSales;
      if (typeof v === "number") total += v;
    });
    return Math.round(total * 100) / 100;
  } catch (err) {
    console.warn("[suppliers/summary] sales read failed", monthISO, err);
    return 0;
  }
}

function totalOf(m: StoredMonth | null): number {
  if (!m?.suppliers) return 0;
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

    const [monthData, salesData] = await Promise.all([
      Promise.all(monthKeys.map(loadMonth)),
      Promise.all(monthKeys.map(loadMonthSales)),
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
    function costFor(m: StoredMonth | null, name: string): number {
      const row = m?.suppliers?.find((s) => s.name === name);
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
        target: current?.targetPct ?? 28,
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

// Keep TIMEZONE reachable for callers importing the module.
export const CONFIG_TIMEZONE = TIMEZONE;
