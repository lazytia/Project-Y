import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import {
  fetchPayrollSheetRows,
  isEmptyPayrollDetail,
  parseWeekPayrollDetailFromRows,
  parseWeeklyPayrollTotalsFromRows,
  type WeeklyPayrollRow,
  type WeekPayrollDetail,
} from "@/lib/payroll-sheet";
import { warmWeekSalesCache } from "@/lib/square-weekly-daily";
import { shiftDateKey } from "@/lib/square";

/**
 * GET /api/payroll/summary?weekStart=YYYY-MM-DD
 *
 * Powers /payroll/payroll. Returns the selected week's payroll detail
 * plus the previous two weeks (for the "vs prev 2 weeks avg" chips and
 * the WEEKLY COMPARISON card), and pulls the matching Sydney-week Gross
 * Sales from Firestore so the payroll % of sales gauge is meaningful.
 */

export const dynamic = "force-dynamic";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIMEZONE = "Australia/Sydney";

/** 1 hour TTL for past weeks (finalised pay runs); 15 min for the current
 *  running week. */
const PAST_TTL_MS = 60 * 60 * 1000;
const CURRENT_TTL_MS = 15 * 60 * 1000;

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=1800",
} as const;

type CachedDetail = {
  detail: WeekPayrollDetail;
  computedAt?: Timestamp;
};

function todayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TIMEZONE });
}

/** The sheet leaves Total Inc Super blank on employee rows, so derive
 *  it from the components. Applied to whatever the parser/cache returned
 *  so stale cached entries with 0 totals still surface a correct number. */
function normaliseDetail(d: WeekPayrollDetail): WeekPayrollDetail {
  const employees = d.employees.map((e) => {
    const derived = e.netPay + e.tax + e.superAnn + e.cashPay;
    const totalIncSuper = e.totalIncSuper > 0 ? e.totalIncSuper : derived;
    return { ...e, totalIncSuper: Math.round(totalIncSuper * 100) / 100 };
  });
  const t = d.totals;
  const derivedTotal = t.netPay + t.tax + t.superAnn + t.cashPay;
  const totalIncSuper =
    t.totalIncSuper > 0
      ? t.totalIncSuper
      : Math.round(derivedTotal * 100) / 100;
  return {
    ...d,
    employees,
    totals: { ...t, totalIncSuper },
  };
}

async function readSummaryCache(
  weekStart: string,
  opts: { respectTtl: boolean },
): Promise<WeekPayrollDetail | null> {
  try {
    const snap = await adminDb().collection("payroll_summary_cache").doc(weekStart).get();
    if (!snap.exists) return null;
    const data = snap.data() as CachedDetail | undefined;
    if (!data?.detail) return null;
    const normalised = normaliseDetail(data.detail);
    if (isEmptyPayrollDetail(normalised)) return null;

    if (opts.respectTtl) {
      const today = todayKey();
      const weekEnd = shiftDateKey(weekStart, 6, TIMEZONE);
      const isPast = weekEnd < today;
      const computedAt = data.computedAt?.toDate?.() ?? null;
      const ttl = isPast ? PAST_TTL_MS : CURRENT_TTL_MS;
      if (!computedAt || Date.now() - computedAt.getTime() >= ttl) return null;
    }
    return normalised;
  } catch (err) {
    console.warn("[payroll/summary] cache read failed:", err);
    return null;
  }
}

async function readPayrollWeeklyFallback(weekStart: string): Promise<WeekPayrollDetail | null> {
  try {
    const snap = await adminDb().collection("payroll_weekly").doc(weekStart).get();
    if (!snap.exists) return null;
    const data = snap.data() as {
      weekEndISO?: string;
      totalIncSuper?: number;
      gross?: number;
    };
    const totalIncSuper = data.totalIncSuper ?? data.gross;
    if (typeof totalIncSuper !== "number" || totalIncSuper <= 0) return null;
    return {
      weekStartISO: weekStart,
      weekEndISO: data.weekEndISO ?? shiftDateKey(weekStart, 6, TIMEZONE),
      employees: [],
      totals: {
        netPay: 0,
        tax: 0,
        superAnn: 0,
        cashPay: 0,
        totalIncSuper: Math.round(totalIncSuper * 100) / 100,
      },
    };
  } catch (err) {
    console.warn("[payroll/summary] payroll_weekly lookup failed:", err);
    return null;
  }
}

function detailFromWeeklyTotal(
  weekStart: string,
  row: WeeklyPayrollRow,
  partial: WeekPayrollDetail | null,
): WeekPayrollDetail {
  return {
    weekStartISO: row.weekStartISO,
    weekEndISO: row.weekEndISO,
    employees: partial?.employees ?? [],
    totals: {
      netPay: partial?.totals.netPay ?? 0,
      tax: partial?.totals.tax ?? 0,
      superAnn: partial?.totals.superAnn ?? 0,
      cashPay: partial?.totals.cashPay ?? 0,
      totalIncSuper: row.totalIncSuper,
    },
  };
}

async function persistDetailCache(weekStart: string, detail: WeekPayrollDetail): Promise<void> {
  adminDb()
    .collection("payroll_summary_cache")
    .doc(weekStart)
    .set(
      { detail, computedAt: Timestamp.now() },
      { merge: true },
    )
    .catch((err) => console.warn("[payroll/summary] cache write failed:", err));
}

async function loadDetailCached(
  weekStart: string,
  sheetRows: unknown[][] | null,
  weeklyTotals: Record<string, WeeklyPayrollRow>,
): Promise<WeekPayrollDetail | null> {
  try {
    if (sheetRows) {
      let fresh: WeekPayrollDetail | null = null;
      try {
        fresh = parseWeekPayrollDetailFromRows(sheetRows, weekStart);
      } catch (err) {
        console.warn("[payroll/summary] sheet parse failed for", weekStart, err);
      }
      if (isEmptyPayrollDetail(fresh) && weeklyTotals[weekStart]) {
        fresh = detailFromWeeklyTotal(weekStart, weeklyTotals[weekStart], fresh);
      }
      if (!isEmptyPayrollDetail(fresh)) {
        const normalised = normaliseDetail(fresh!);
        await persistDetailCache(weekStart, normalised);
        return normalised;
      }
    }

    const freshCache = await readSummaryCache(weekStart, { respectTtl: true });
    if (freshCache) return freshCache;

    const weeklyFallback = await readPayrollWeeklyFallback(weekStart);
    if (weeklyFallback) return normaliseDetail(weeklyFallback);

    const staleCache = await readSummaryCache(weekStart, { respectTtl: false });
    if (staleCache) return staleCache;
  } catch (err) {
    console.warn("[payroll/summary] loadDetailCached failed for", weekStart, err);
  }
  return null;
}

/** Sales lookup precedence:
 *   1. sales_weekly_daily/{weekStart} — the Square-direct cache the
 *      /money/sales page fills. Covers older months that sales_daily
 *      doesn't have.
 *   2. sales_daily range query — nightly Firestore cache, recent
 *      months only. */
async function loadWeekSales(weekStart: string): Promise<number> {
  try {
    const cacheSnap = await adminDb()
      .collection("sales_weekly_daily")
      .doc(weekStart)
      .get();
    if (cacheSnap.exists) {
      const data = cacheSnap.data() as { thisWeek?: { total?: number } };
      const t = data.thisWeek?.total;
      if (typeof t === "number" && t > 0) return Math.round(t * 100) / 100;
    }
  } catch (err) {
    console.warn("[payroll/summary] weekly-cache lookup failed:", err);
  }

  const startISO = weekStart;
  const endISO = shiftDateKey(weekStart, 6, TIMEZONE);
  try {
    const snap = await adminDb()
      .collection("sales_daily")
      .where("dateISO", ">=", startISO)
      .where("dateISO", "<=", endISO)
      .get();
    let total = 0;
    snap.docs.forEach((d) => {
      const v = d.data().grossSales;
      if (typeof v === "number") total += v;
    });
    if (total > 0) return Math.round(total * 100) / 100;
  } catch (err) {
    console.warn("[payroll/summary] sales_daily lookup failed:", err);
  }
  return 0;
}

/** Read cache first; warm from Square one week at a time on miss. */
async function loadWeekSalesResolved(weekStarts: string[]): Promise<number[]> {
  const out = await Promise.all(weekStarts.map((ws) => loadWeekSales(ws)));
  for (let i = 0; i < weekStarts.length; i += 1) {
    if (out[i] > 0) continue;
    try {
      const warmed = await warmWeekSalesCache(weekStarts[i]);
      if (warmed > 0) {
        out[i] = warmed;
        continue;
      }
      const retry = await loadWeekSales(weekStarts[i]);
      if (retry > 0) out[i] = retry;
    } catch (err) {
      console.warn("[payroll/summary] warm weekly sales failed for", weekStarts[i], err);
    }
  }
  return out;
}

export async function GET(req: NextRequest) {
  const weekStart = req.nextUrl.searchParams.get("weekStart");
  if (!weekStart || !DATE_KEY_RE.test(weekStart)) {
    return NextResponse.json({ error: "weekStart=YYYY-MM-DD required" }, { status: 400 });
  }

  const prev1 = shiftDateKey(weekStart, -7, TIMEZONE);
  const prev2 = shiftDateKey(weekStart, -14, TIMEZONE);

  let sheetRows: unknown[][] | null = null;
  let weeklyTotals: Record<string, WeeklyPayrollRow> = {};
  try {
    sheetRows = await fetchPayrollSheetRows();
    weeklyTotals = parseWeeklyPayrollTotalsFromRows(sheetRows);
  } catch (err) {
    console.warn("[payroll/summary] sheet read failed:", err);
  }

  const [currentDetail, prev1Detail, prev2Detail, sales] = await Promise.all([
    loadDetailCached(weekStart, sheetRows, weeklyTotals),
    loadDetailCached(prev1, sheetRows, weeklyTotals),
    loadDetailCached(prev2, sheetRows, weeklyTotals),
    loadWeekSalesResolved([weekStart, prev1, prev2]),
  ]);

  const [salesCurrent, salesPrev1, salesPrev2] = sales;

  const empty = {
    weekStartISO: "",
    weekEndISO: "",
    employees: [],
    totals: { netPay: 0, tax: 0, superAnn: 0, cashPay: 0, totalIncSuper: 0 },
  } as WeekPayrollDetail;

  const cur = currentDetail ?? { ...empty, weekStartISO: weekStart };
  const p1 = prev1Detail ?? { ...empty, weekStartISO: prev1 };
  const p2 = prev2Detail ?? { ...empty, weekStartISO: prev2 };

  // Average of prev 2 weeks for the "vs prev 2 weeks avg" chips.
  const avg2 = {
    netPay: (p1.totals.netPay + p2.totals.netPay) / 2,
    tax: (p1.totals.tax + p2.totals.tax) / 2,
    superAnn: (p1.totals.superAnn + p2.totals.superAnn) / 2,
    cashPay: (p1.totals.cashPay + p2.totals.cashPay) / 2,
    totalIncSuper: (p1.totals.totalIncSuper + p2.totals.totalIncSuper) / 2,
  };

  const payrollPctSales =
    salesCurrent > 0 ? (cur.totals.totalIncSuper / salesCurrent) * 100 : null;
  const prev2WeeksSales = salesPrev1 + salesPrev2;
  const prev2WeeksPayroll = p1.totals.totalIncSuper + p2.totals.totalIncSuper;
  const payrollPctPrev =
    prev2WeeksSales > 0 ? (prev2WeeksPayroll / prev2WeeksSales) * 100 : null;

  return NextResponse.json(
    {
      weekStart,
      weekEnd: shiftDateKey(weekStart, 6, TIMEZONE),
      current: cur,
      previous: p1,
      twoWeeksAgo: p2,
      prev2WeekAvg: avg2,
      sales: {
        current: salesCurrent,
        prev1: salesPrev1,
        prev2: salesPrev2,
      },
      payrollPctSales,
      payrollPctPrev,
    },
    { headers: CACHE_HEADERS },
  );
}
