import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { fetchWeekPayrollDetail, type WeekPayrollDetail } from "@/lib/payroll-sheet";
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
    const derived = e.netPay + e.tax + e.superAnn;
    const totalIncSuper = e.totalIncSuper > 0 ? e.totalIncSuper : derived;
    return { ...e, totalIncSuper: Math.round(totalIncSuper * 100) / 100 };
  });
  const t = d.totals;
  const derivedTotal = t.netPay + t.tax + t.superAnn;
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

async function loadDetailCached(weekStart: string): Promise<WeekPayrollDetail | null> {
  const today = todayKey();
  const weekEnd = shiftDateKey(weekStart, 6, TIMEZONE);
  const isPast = weekEnd < today;

  try {
    const snap = await adminDb().collection("payroll_summary_cache").doc(weekStart).get();
    if (snap.exists) {
      const data = snap.data() as CachedDetail | undefined;
      const computedAt = data?.computedAt?.toDate?.() ?? null;
      const ttl = isPast ? PAST_TTL_MS : CURRENT_TTL_MS;
      if (data?.detail && computedAt && Date.now() - computedAt.getTime() < ttl) {
        return normaliseDetail(data.detail);
      }
    }
  } catch (err) {
    console.warn("[payroll/summary] cache read failed:", err);
  }

  const fresh = await fetchWeekPayrollDetail(weekStart).catch((err) => {
    console.warn("[payroll/summary] sheet fetch failed for", weekStart, err);
    return null;
  });
  if (fresh) {
    const normalised = normaliseDetail(fresh);
    adminDb()
      .collection("payroll_summary_cache")
      .doc(weekStart)
      .set(
        { detail: normalised, computedAt: Timestamp.now() },
        { merge: true },
      )
      .catch((err) => console.warn("[payroll/summary] cache write failed:", err));
    return normalised;
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

/** loadWeekSales, but if no cache is populated for the week, kick off a
 *  background compute against /api/square/weekly-daily so the very next
 *  visit resolves against a real number. The current request still
 *  returns whatever loadWeekSales found (usually 0), so the page renders
 *  "—%" once and then the correct value on refresh. */
async function loadWeekSalesWithWarm(reqUrl: string, weekStart: string): Promise<number> {
  const cached = await loadWeekSales(weekStart);
  if (cached > 0) return cached;
  // Fire and forget — no await, so the current response stays fast.
  void (async () => {
    try {
      const origin = new URL(reqUrl).origin;
      const target = `${origin}/api/square/weekly-daily?weekStart=${weekStart}`;
      await fetch(target, { cache: "no-store" });
    } catch (err) {
      console.warn("[payroll/summary] warm weekly-daily failed:", err);
    }
  })();
  return 0;
}

export async function GET(req: NextRequest) {
  const weekStart = req.nextUrl.searchParams.get("weekStart");
  if (!weekStart || !DATE_KEY_RE.test(weekStart)) {
    return NextResponse.json({ error: "weekStart=YYYY-MM-DD required" }, { status: 400 });
  }

  try {
    const prev1 = shiftDateKey(weekStart, -7, TIMEZONE);
    const prev2 = shiftDateKey(weekStart, -14, TIMEZONE);

    const [currentDetail, prev1Detail, prev2Detail, salesCurrent, salesPrev1, salesPrev2] =
      await Promise.all([
        loadDetailCached(weekStart),
        loadDetailCached(prev1),
        loadDetailCached(prev2),
        loadWeekSalesWithWarm(req.url, weekStart),
        loadWeekSalesWithWarm(req.url, prev1),
        loadWeekSalesWithWarm(req.url, prev2),
      ]);

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
  } catch (err) {
    console.error("[payroll/summary] error:", err);
    return NextResponse.json({ error: "Failed to build payroll summary" }, { status: 502 });
  }
}
