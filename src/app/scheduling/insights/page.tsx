"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  getDocs,
  type Timestamp,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { isOwner } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

/* ──────────────────────────────────────────────────────────────────────
 * Roster Insight — owner/manager analytics dashboard.
 *
 * All numbers come from the rosters_published Firestore collection
 * (assignments per day per meal). We don't yet have the Square sales
 * pipeline or a per-staff payroll table, so:
 *
 *   - PAYROLL COST is estimated as (#shifts × shift hours × est. rate).
 *   - ROSTER COST (planned) is the same estimate (we only store one
 *     assignments map per day for now).
 *   - SALES + PAYROLL % require sales data; until that's wired, they
 *     show "—" with no comparison.
 *
 * Tune the constants below once the real data sources land.
 * ──────────────────────────────────────────────────────────────────── */

const TARGET_PAYROLL_PCT = 25;
const EST_HOURLY_RATE = 25;
const LUNCH_END_H = 14;   // 2:00 pm
const DINNER_END_H = 21;  // 9:00 pm

function shiftHours(startTime: string, endHour: number, fallbackHours: number): number {
  if (!startTime) return fallbackHours;
  const [h, m] = startTime.split(":").map(Number);
  if (isNaN(h) || h > 23) return fallbackHours; // old data stored staff name, not time
  return Math.max(0, endHour - h - (m ?? 0) / 60);
}
const TREND_WEEKS = 4; // current + previous 3

type Meal = "lunch" | "dinner";

type StaffRate = { weekRate: number; satRate: number };

type WeekDoc = {
  assignments?: Record<string, Record<Meal, Record<string, string>>>;
};

/**
 * payroll_weekly/{weekStartISO} — populated by the Xero sync job.
 * Pay run runs every Friday; the document keyed by the Monday of that
 * work week stores the gross wages and super separately so we can show
 * either the gross or the all-in (gross + super) total.
 *
 *   {
 *     weekStartISO: "2026-06-15",
 *     payDate: <Timestamp>,         // Friday pay run
 *     gross: 7400,                  // total gross wages for the week
 *     super: 814,                   // 11 % super (or per-employee actual)
 *     source: "xero" | "manual",
 *     syncedAt?: <Timestamp>,
 *   }
 */
type WeeklyPayroll = {
  weekStartISO?: string;
  payDate?: Timestamp;
  gross?: number;
  super?: number;
  source?: "xero" | "manual";
};

/**
 * sales_weekly/{weekStartISO} — populated by the Square sync job. Stores
 * the Square Web "Gross Sales" total (line item gross sales minus
 * refunds) so Insights can show real sales and Payroll %.
 */
type WeeklySales = {
  weekStartISO?: string;
  grossSales?: number;
  currency?: string;
  source?: "square" | "manual";
};

type DailySales = {
  dateISO?: string;
  weekStartISO?: string;
  grossSales?: number;
};

type WeekStats = {
  weekStartISO: string;
  totalShifts: number;
  estimatedCost: number;
  byDay: Record<string, { shifts: number; cost: number }>;
};

function startOfWeekMon(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = (x.getDay() + 6) % 7; // Mon = 0
  x.setDate(x.getDate() - day);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtPct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}

function fmtRange(a: Date, b: Date): string {
  const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  if (sameMonth) return `${a.getDate()} – ${b.toLocaleDateString("en-AU", opts)}`;
  return `${a.toLocaleDateString("en-AU", opts)} – ${b.toLocaleDateString("en-AU", opts)}`;
}

function fmtDayLong(d: Date): string {
  return d.toLocaleDateString("en-AU", { weekday: "long" });
}

function fmtWeekShortDate(d: Date): string {
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function aggregateWeek(weekStart: Date, doc: WeekDoc | undefined, rates: Record<string, StaffRate>): WeekStats {
  const stats: WeekStats = {
    weekStartISO: isoDate(weekStart),
    totalShifts: 0,
    estimatedCost: 0,
    byDay: {},
  };
  for (let i = 0; i < 7; i += 1) {
    const d = addDays(weekStart, i);
    const iso = isoDate(d);
    const lunchMap = doc?.assignments?.[iso]?.lunch ?? {};
    const dinnerMap = doc?.assignments?.[iso]?.dinner ?? {};
    const isSaturday = d.getDay() === 6;

    let dayCost = 0;
    for (const [uid, startTime] of Object.entries(lunchMap)) {
      const weekRate = rates[uid]?.weekRate ?? EST_HOURLY_RATE;
      const actualRate = isSaturday ? (rates[uid]?.satRate ?? weekRate) : weekRate;
      const hours = shiftHours(startTime as string, LUNCH_END_H, 4);
      dayCost += hours * actualRate;
    }
    for (const [uid, startTime] of Object.entries(dinnerMap)) {
      const weekRate = rates[uid]?.weekRate ?? EST_HOURLY_RATE;
      const actualRate = isSaturday ? (rates[uid]?.satRate ?? weekRate) : weekRate;
      const hours = shiftHours(startTime as string, DINNER_END_H, 5);
      dayCost += hours * actualRate;
    }

    const totalShifts = Object.keys(lunchMap).length + Object.keys(dinnerMap).length;
    stats.byDay[iso] = { shifts: totalShifts, cost: dayCost };
    stats.totalShifts += totalShifts;
    stats.estimatedCost += dayCost;
  }
  return stats;
}

export default function InsightsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwner(user);

  const [docs, setDocs] = useState<Record<string, WeekDoc>>({});
  const [payroll, setPayroll] = useState<Record<string, WeeklyPayroll>>({});
  const [salesMap, setSalesMap] = useState<Record<string, WeeklySales>>({});
  const [dailySalesMap, setDailySalesMap] = useState<Record<string, DailySales>>({});
  const [staffRates, setStaffRates] = useState<Record<string, StaffRate>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!allowed) {
      router.replace(ROUTES.home);
      return;
    }
    (async () => {
      try {
        const snap = await getDocs(collection(getDb(), "rosters_published"));
        const map: Record<string, WeekDoc> = {};
        for (const d of snap.docs) map[d.id] = d.data() as WeekDoc;
        setDocs(map);
      } catch {
        /* keep empty */
      }
      try {
        // Pulled from Xero by the sync job (or entered manually).
        const snap = await getDocs(collection(getDb(), "payroll_weekly"));
        const map: Record<string, WeeklyPayroll> = {};
        for (const d of snap.docs) map[d.id] = d.data() as WeeklyPayroll;
        setPayroll(map);
      } catch {
        /* keep empty */
      }
      try {
        // Pulled from Square by the sync job (gross sales for the week).
        const snap = await getDocs(collection(getDb(), "sales_weekly"));
        const map: Record<string, WeeklySales> = {};
        for (const d of snap.docs) map[d.id] = d.data() as WeeklySales;
        setSalesMap(map);
      } catch {
        /* keep empty */
      }
      try {
        const dailySnap = await getDocs(collection(getDb(), "sales_daily"));
        const dmap: Record<string, DailySales> = {};
        for (const d of dailySnap.docs) dmap[d.id] = d.data() as DailySales;
        setDailySalesMap(dmap);
      } catch { /* ignore */ }
      {
        const ratesMap: Record<string, StaffRate> = {};
        try {
          const snap = await getDocs(collection(getDb(), "staff_onboarding"));
          for (const d of snap.docs) {
            const data = d.data() as Record<string, unknown>;
            const weekRate =
              (typeof data.weekRate === "number" ? data.weekRate : undefined) ??
              (typeof data.weeklyRate === "number" ? data.weeklyRate : undefined) ??
              (typeof data.hourlyRate === "number" ? data.hourlyRate : undefined) ??
              (typeof data.baseRate === "number" ? data.baseRate : undefined) ??
              EST_HOURLY_RATE;
            const satRate =
              (typeof data.satRate === "number" ? data.satRate : undefined) ??
              (typeof data.saturdayRate === "number" ? data.saturdayRate : undefined) ??
              weekRate;
            ratesMap[d.id] = { weekRate, satRate };
          }
        } catch { /* keep empty */ }
        try {
          const snap = await getDocs(collection(getDb(), "staff"));
          for (const d of snap.docs) {
            const data = d.data() as Record<string, unknown>;
            const weekdayRate = typeof data.weekdayRate === "number" ? data.weekdayRate : undefined;
            const saturdayRate = typeof data.saturdayRate === "number" ? data.saturdayRate : undefined;
            if (weekdayRate !== undefined || saturdayRate !== undefined) {
              const ex = ratesMap[d.id];
              ratesMap[d.id] = {
                weekRate: weekdayRate ?? ex?.weekRate ?? EST_HOURLY_RATE,
                satRate: saturdayRate ?? ex?.satRate ?? (weekdayRate ?? EST_HOURLY_RATE),
              };
            }
          }
        } catch { /* keep empty */ }
        setStaffRates(ratesMap);
      }
      setLoading(false);
    })();
  }, [authLoading, allowed, router]);

  // Week anchors
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const todayWeekStart = useMemo(() => startOfWeekMon(today), [today]);

  const [selectedWeekISO, setSelectedWeekISO] = useState<string>(() => isoDate(addDays(startOfWeekMon(new Date()), -7)));
  // Free-form range the user picked via the calendar. Starts seeded to the
  // selected week's Mon–Sat span; once they pick a custom range we trust it.
  const [rangeStartISO, setRangeStartISO] = useState<string>(() => isoDate(addDays(startOfWeekMon(new Date()), -7)));
  const [rangeEndISO, setRangeEndISO] = useState<string>(() => isoDate(addDays(addDays(startOfWeekMon(new Date()), -7), 6)));
  const [weekPickerOpen, setWeekPickerOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const currentWeekStart = useMemo(() => {
    const [y, m, d] = selectedWeekISO.split("-").map(Number);
    if (!y || !m || !d) return todayWeekStart;
    return new Date(y, m - 1, d);
  }, [selectedWeekISO, todayWeekStart]);
  const prevWeekStart = useMemo(() => addDays(currentWeekStart, -7), [currentWeekStart]);

  // Build the list of weeks — past weeks only (up to the week before this week).
  // Future weeks and current week are excluded.
  const weekOptions = useMemo(() => {
    const prevWeekISO = isoDate(addDays(todayWeekStart, -7));
    const set = new Set<string>();
    // Include all rosters_published entries that are before this week.
    for (const iso of Object.keys(docs)) {
      if (iso <= prevWeekISO) set.add(iso);
    }
    // Always include the last 8 weeks for navigation.
    for (let i = 1; i <= 8; i += 1) set.add(isoDate(addDays(todayWeekStart, -7 * i)));
    return Array.from(set).sort((a, b) => (a < b ? 1 : -1));
  }, [docs, todayWeekStart]);

  // Aggregations
  const currentWeek = useMemo(
    () => aggregateWeek(currentWeekStart, docs[isoDate(currentWeekStart)], staffRates),
    [currentWeekStart, docs, staffRates],
  );
  const prevWeek = useMemo(
    () => aggregateWeek(prevWeekStart, docs[isoDate(prevWeekStart)], staffRates),
    [prevWeekStart, docs, staffRates],
  );

  // Trend (last TREND_WEEKS including current)
  const trend = useMemo(() => {
    const out: WeekStats[] = [];
    for (let i = TREND_WEEKS - 1; i >= 0; i -= 1) {
      const start = addDays(currentWeekStart, -7 * i);
      out.push(aggregateWeek(start, docs[isoDate(start)], staffRates));
    }
    return out;
  }, [currentWeekStart, docs, staffRates]);

  // Resolve actual payroll (gross + super) from payroll_weekly when
  // it's been synced; otherwise fall back to the roster estimate.
  function actualOrEstimate(weekStart: Date, estimate: number): { value: number; isActual: boolean } {
    const iso = isoDate(weekStart);
    const row = payroll[iso];
    if (row && typeof row.gross === "number") {
      const total = row.gross + (typeof row.super === "number" ? row.super : 0);
      return { value: total, isActual: true };
    }
    return { value: estimate, isActual: false };
  }
  const currentPayroll = actualOrEstimate(currentWeekStart, currentWeek.estimatedCost);
  const prevPayroll = actualOrEstimate(prevWeekStart, prevWeek.estimatedCost);
  const payrollCost = currentPayroll.value;
  const prevPayrollCost = prevPayroll.value;
  const payrollIsActual = currentPayroll.isActual;
  const rosterPlanned = currentWeek.estimatedCost; // planned always from roster estimate
  const variance = payrollCost - rosterPlanned;

  // Square Gross Sales for this week (used in Planned vs Actual section).
  const sales = salesMap[isoDate(currentWeekStart)]?.grossSales ?? 0;
  const hasSales = sales > 0;
  const payrollPct = hasSales ? (payrollCost / sales) * 100 : 0;

  // Highest cost day
  // Rank by roster estimate when we have a published roster; otherwise
  // fall back to daily sales (busiest day proxies for highest cost).
  // Day's payroll is the roster estimate when present; if the weekly
  // actual payroll is synced, prorate it across days using the sales
  // share so the card shows real dollars instead of $0.
  const highestDay = useMemo(() => {
    type Best = {
      iso: string;
      date: Date;
      cost: number;
      shifts: number;
      dailySales: number;
      shareOfWeek: number;
    };
    const days: Array<{
      iso: string;
      date: Date;
      rosterCost: number;
      shifts: number;
      dailySales: number;
    }> = [];
    let totalRosterCost = 0;
    let totalDailySales = 0;
    for (let i = 0; i < 7; i += 1) {
      const d = addDays(currentWeekStart, i);
      const iso = isoDate(d);
      const day = currentWeek.byDay[iso];
      const rosterCost = day?.cost ?? 0;
      const shifts = day?.shifts ?? 0;
      const dailySales = dailySalesMap[iso]?.grossSales ?? 0;
      totalRosterCost += rosterCost;
      totalDailySales += dailySales;
      days.push({ iso, date: d, rosterCost, shifts, dailySales });
    }
    // Always show a card — pick by whichever metric has signal, even
    // if it's only weekly data we can prorate.
    if (days.length === 0) return null;

    // Pick the winner by whichever metric we have signal for.
    const rankBySales = totalRosterCost === 0;
    days.sort((a, b) =>
      rankBySales ? b.dailySales - a.dailySales : b.rosterCost - a.rosterCost,
    );
    const top = days[0];

    // Day's payroll: roster estimate if available; otherwise prorate
    // the weekly actual by sales share so we still show a real number.
    let dayPayroll = top.rosterCost;
    if (dayPayroll === 0 && payrollCost > 0 && totalDailySales > 0) {
      dayPayroll = payrollCost * (top.dailySales / totalDailySales);
    }
    const weekBase = payrollCost > 0 ? payrollCost : totalRosterCost;
    const shareOfWeek = weekBase > 0 ? (dayPayroll / weekBase) * 100 : 0;

    const best: Best = {
      iso: top.iso,
      date: top.date,
      cost: dayPayroll,
      shifts: top.shifts,
      dailySales: top.dailySales,
      shareOfWeek,
    };
    return best;
  }, [currentWeek, currentWeekStart, dailySalesMap, payrollCost]);

  // Trend chart geometry — actual payroll when synced from Xero,
  // estimated from roster otherwise. For each week we also compute
  // payroll % (payroll / sales × 100) so the chart can plot the same
  // metric the snapshot card highlights.
  const trendWithActuals = useMemo(
    () =>
      trend.map((w) => {
        const [y, m, d] = w.weekStartISO.split("-").map(Number);
        const start = new Date(y, m - 1, d);
        const resolved = actualOrEstimate(start, w.estimatedCost);
        const weekSales = salesMap[w.weekStartISO]?.grossSales ?? 0;
        const pct = weekSales > 0 ? (resolved.value / weekSales) * 100 : null;
        return {
          ...w,
          displayCost: resolved.value,
          isActual: resolved.isActual,
          pct,
          sales: weekSales,
        };
      }),
    [trend, payroll, salesMap], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const trendHasPct = trendWithActuals.some((w) => w.pct !== null);
  const chart = useMemo(
    () => buildTrendChart(trendWithActuals, trendHasPct, TARGET_PAYROLL_PCT),
    [trendWithActuals, trendHasPct],
  );

  // Comparison labels
  const compareSales = prevPayrollCost > 0
    ? ((payrollCost - prevPayrollCost) / prevPayrollCost) * 100
    : 0;

  // SALES delta vs last week — we don't have sales yet
  // PAYROLL COST delta
  const payrollVsLast = compareSales;

  const weekEnd = useMemo(() => addDays(currentWeekStart, 5), [currentWeekStart]); // Mon→Sat
  const prevWeekEnd = useMemo(() => addDays(prevWeekStart, 5), [prevWeekStart]);

  // Range-scoped metrics derived from the calendar picker selection
  const rangeSales = useMemo(() => {
    let total = 0;
    const [sy, sm, sd] = rangeStartISO.split("-").map(Number);
    const [ey, em, ed] = rangeEndISO.split("-").map(Number);
    if (!sy || !ey) return 0;
    const start = new Date(sy, sm - 1, sd);
    const end = new Date(ey, em - 1, ed);
    let cur = new Date(start);
    while (cur <= end) {
      total += dailySalesMap[isoDate(cur)]?.grossSales ?? 0;
      cur = addDays(cur, 1);
    }
    return total;
  }, [rangeStartISO, rangeEndISO, dailySalesMap]);

  const rangePayrollCost = useMemo(() => {
    let total = 0;
    const [sy, sm, sd] = rangeStartISO.split("-").map(Number);
    const [ey, em, ed] = rangeEndISO.split("-").map(Number);
    if (!sy || !ey) return 0;
    const start = new Date(sy, sm - 1, sd);
    const end = new Date(ey, em - 1, ed);
    let cur = new Date(start);
    while (cur <= end) {
      const iso = isoDate(cur);
      const weekStart = isoDate(startOfWeekMon(cur));
      const weekDoc = docs[weekStart];
      const lunchMap = weekDoc?.assignments?.[iso]?.lunch ?? {};
      const dinnerMap = weekDoc?.assignments?.[iso]?.dinner ?? {};
      const isSat = cur.getDay() === 6;
      for (const [uid, startTime] of Object.entries(lunchMap)) {
        const wr = staffRates[uid]?.weekRate ?? EST_HOURLY_RATE;
        const rate = isSat ? (staffRates[uid]?.satRate ?? wr) : wr;
        total += shiftHours(startTime as string, LUNCH_END_H, 4) * rate;
      }
      for (const [uid, startTime] of Object.entries(dinnerMap)) {
        const wr = staffRates[uid]?.weekRate ?? EST_HOURLY_RATE;
        const rate = isSat ? (staffRates[uid]?.satRate ?? wr) : wr;
        total += shiftHours(startTime as string, DINNER_END_H, 5) * rate;
      }
      cur = addDays(cur, 1);
    }
    return total;
  }, [rangeStartISO, rangeEndISO, docs, staffRates]);

  const rangeHasSales = rangeSales > 0;
  const rangePayrollPct = rangeHasSales ? (rangePayrollCost / rangeSales) * 100 : null;
  const rangeOverTarget = rangePayrollPct !== null && rangePayrollPct > TARGET_PAYROLL_PCT;

  // Auto-sync when the page first loads (and when the manager picks
  // a different week). Runs in the background — the existing
  // Firestore-read pass renders any stale data immediately so the
  // page never blocks on Square / Xero round-trips.
  const hasAutoRefreshed = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (authLoading || loading || !user || !allowed) return;
    if (refreshing) return;
    if (hasAutoRefreshed.current.has(selectedWeekISO)) return;
    hasAutoRefreshed.current.add(selectedWeekISO);
    const id = setTimeout(() => {
      void handleRefresh();
    }, 50);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, loading, user, allowed, selectedWeekISO]);

  async function handleRefresh() {
    if (refreshing || !user) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/insights/refresh?week=${selectedWeekISO}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `Refresh failed (${res.status})`);
      // Only surface a message when a real error came back from one of
      // the integrations. Successful syncs stay silent so the dashboard
      // doesn't carry an unrelated green banner around.
      const sqErr = data?.square?.error;
      const payErr = data?.xero?.error; // field name kept for back-compat
      if (sqErr || payErr) {
        const parts: string[] = [];
        if (sqErr) parts.push(`Square: ${sqErr}`);
        if (payErr) parts.push(`Payroll: ${payErr}`);
        setRefreshError(parts.join("  |  "));
      } else {
        setRefreshError(null);
      }
      // Re-read both Firestore maps after the sync wrote new docs.
      try {
        const snap = await getDocs(collection(getDb(), "payroll_weekly"));
        const map: Record<string, WeeklyPayroll> = {};
        for (const d of snap.docs) map[d.id] = d.data() as WeeklyPayroll;
        setPayroll(map);
      } catch { /* ignore */ }
      try {
        const snap = await getDocs(collection(getDb(), "sales_weekly"));
        const map: Record<string, WeeklySales> = {};
        for (const d of snap.docs) map[d.id] = d.data() as WeeklySales;
        setSalesMap(map);
      } catch { /* ignore */ }
      try {
        const dailySnap = await getDocs(collection(getDb(), "sales_daily"));
        const dmap: Record<string, DailySales> = {};
        for (const d of dailySnap.docs) dmap[d.id] = d.data() as DailySales;
        setDailySalesMap(dmap);
      } catch { /* ignore */ }
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : "Refresh failed.");
    } finally {
      setRefreshing(false);
    }
  }

  if (authLoading || loading) return <Splash />;
  if (!allowed) return null;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => router.push("/")}
          aria-label="Back"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className={styles.title}>Roster Insight</h1>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={handleRefresh}
          disabled={refreshing}
          aria-label="Refresh from Square / Xero"
          title="Refresh from Square / Xero"
        >
          {refreshing ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" strokeDasharray="36 36" strokeDashoffset="0">
                <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite" />
              </circle>
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          )}
        </button>
      </header>

      {refreshError && refreshError.startsWith("Square:") && (
        <p className={styles.refreshError}>{refreshError}</p>
      )}

      <div className={styles.weekRow}>
        <div className={styles.weekPickerWrap}>
          <button
            type="button"
            className={styles.weekPill}
            onClick={() => setWeekPickerOpen((s) => !s)}
            aria-haspopup="listbox"
            aria-expanded={weekPickerOpen}
          >
            <span>{fmtRange(
              (() => { const [y, m, d] = rangeStartISO.split("-").map(Number); return new Date(y, m - 1, d); })(),
              (() => { const [y, m, d] = rangeEndISO.split("-").map(Number); return new Date(y, m - 1, d); })(),
            )}</span>
            <span className={`${styles.weekChev} ${weekPickerOpen ? styles.weekChevOpen : ""}`}>▾</span>
          </button>
          {weekPickerOpen && (
            <>
              <button
                type="button"
                className={styles.weekBackdrop}
                onClick={() => setWeekPickerOpen(false)}
                aria-label="Close week picker"
              />
              <RangeCalendarPicker
                rangeStartISO={rangeStartISO}
                rangeEndISO={rangeEndISO}
                onSelect={(startISO, endISO) => {
                  setRangeStartISO(startISO);
                  setRangeEndISO(endISO);
                  // Existing aggregations are keyed by Monday-of-week — derive
                  // it from whichever date the user picked first so the
                  // snapshot / trend lines still load.
                  const [y, m, d] = startISO.split("-").map(Number);
                  setSelectedWeekISO(isoDate(startOfWeekMon(new Date(y, m - 1, d))));
                  setWeekPickerOpen(false);
                }}
              />
            </>
          )}
        </div>
      </div>

      {/* Snapshot card — values are scoped to the selected date range */}
      <section className={styles.snapshot}>
        <div className={styles.snapshotCol}>
          <p className={styles.snapshotLabel}>SALES</p>
          <p className={styles.snapshotValue}>{rangeHasSales ? fmtCurrency(rangeSales) : "—"}</p>
          <p className={styles.snapshotMeta}>
            {rangeHasSales ? "Gross sales (range)" : "No sales data"}
          </p>
        </div>
        <div className={styles.snapshotDivider} />
        <div className={styles.snapshotCol}>
          <p className={styles.snapshotLabel}>PAYROLL %</p>
          <p className={`${styles.snapshotValue} ${rangeOverTarget ? styles.snapshotValueDanger : styles.snapshotValueWarm}`}>
            {rangePayrollPct !== null ? fmtPct(rangePayrollPct) : "—"}
          </p>
          {rangePayrollPct !== null ? (
            <span className={`${styles.targetPill} ${rangeOverTarget ? styles.targetPillDanger : styles.targetPillOk}`}>
              <span className={styles.targetIcon} aria-hidden="true">
                {rangeOverTarget ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="6" y1="6" x2="18" y2="18" />
                    <line x1="18" y1="6" x2="6" y2="18" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </span>
              {rangeOverTarget ? "Over Target" : "Under Target"}
            </span>
          ) : (
            <span className={styles.snapshotMeta}>Needs sales data</span>
          )}
          <p className={styles.snapshotTargetLine}>Target {fmtPct(TARGET_PAYROLL_PCT)}</p>
        </div>
        <div className={styles.snapshotDivider} />
        <div className={styles.snapshotCol}>
          <p className={styles.snapshotLabel}>PAYROLL COST</p>
          <p className={styles.snapshotValue}>{rangePayrollCost > 0 ? fmtCurrency(rangePayrollCost) : "—"}</p>
          <p className={styles.snapshotMeta}>
            {rangePayrollCost > 0 ? "Roster estimate (range)" : "No roster data"}
          </p>
        </div>
      </section>

      {/* Planned vs Actual */}
      <section className={styles.card}>
        <p className={styles.cardTitle}>PLANNED VS ACTUAL</p>
        <div className={styles.pvaGrid}>
          <div className={styles.pvaCol}>
            <p className={styles.pvaLabel}>ROSTER COST (PLANNED)</p>
            <p className={styles.pvaValue}>{fmtCurrency(rosterPlanned)}</p>
            <p className={styles.pvaMeta}>{hasSales ? `${fmtPct((rosterPlanned / sales) * 100)} of sales` : "Estimated"}</p>
          </div>
          <span className={styles.pvaOp} aria-hidden="true">−</span>
          <div className={styles.pvaCol}>
            <p className={styles.pvaLabel}>
              PAYROLL COST (ACTUAL)
            </p>
            <p className={`${styles.pvaValue} ${styles.pvaValueWarm}`}>{fmtCurrency(payrollCost)}</p>
            <p className={styles.pvaMeta}>
              {hasSales
                ? `${fmtPct(payrollPct)} of sales`
                : payrollIsActual ? "incl. super" : "Estimated"}
            </p>
          </div>
          <span className={styles.pvaOp} aria-hidden="true">=</span>
          <div className={styles.pvaCol}>
            <p className={styles.pvaLabel}>VARIANCE</p>
            <p className={`${styles.pvaValue} ${variance > 0 ? styles.pvaValueWarm : ""}`}>
              {variance >= 0 ? "+" : "−"}{fmtCurrency(Math.abs(variance))}
            </p>
            <p className={styles.pvaMeta}>
              {hasSales ? `${variance >= 0 ? "+" : ""}${fmtPct((variance / sales) * 100)} of sales` : "vs roster plan"}
            </p>
          </div>
        </div>
      </section>

      {/* Labour trend */}
      <section>
        <div className={`${styles.card} ${styles.trendCard}`}>
          <p className={styles.cardTitle}>
            LABOUR TREND <span className={styles.cardTitleSub}>
              ({chart.pctMode
                ? "PAYROLL %"
                : trendWithActuals.some((w) => w.isActual)
                  ? "ACTUAL · XERO"
                  : "EST. COST"})
            </span>
          </p>
          {chart.points.every((p) => p.value === 0) ? (
            <p className={styles.emptyChart}>No roster data for the last {TREND_WEEKS} weeks.</p>
          ) : (
            <svg className={styles.trendSvg} viewBox={`0 0 ${chart.width} ${chart.height}`} preserveAspectRatio="none">
              {chart.yLabels.map((y) => (
                <text key={y.value} x={chart.padLeft - 6} y={y.y + 3} className={styles.trendAxis} textAnchor="end">
                  {chart.pctMode ? `${y.value}%` : fmtCurrency(y.value)}
                </text>
              ))}
              <path d={chart.linePath} className={styles.trendLine} />
              {chart.points.map((p, i) => {
                if (p.y === null || p.value === null) return null;
                const isLast = i === chart.points.length - 1;
                // Anchor the last label to the right of its point so the
                // value label can't spill past the chart edge.
                const label = chart.pctMode
                  ? `${p.value.toFixed(1)}%`
                  : fmtCurrency(p.value);
                return (
                  <g key={i}>
                    <circle cx={p.x} cy={p.y} r={3.5} className={styles.trendDot} />
                    <text
                      x={isLast ? p.x - 8 : p.x + 8}
                      y={p.y - 6}
                      textAnchor={isLast ? "end" : "start"}
                      className={styles.trendValue}
                    >
                      {label}
                    </text>
                  </g>
                );
              })}
              {chart.targetY !== null && (
                <>
                  <line
                    x1={chart.padLeft}
                    x2={chart.width - chart.padRight}
                    y1={chart.targetY}
                    y2={chart.targetY}
                    stroke="var(--color-border)"
                    strokeDasharray="4 4"
                    strokeWidth={1}
                  />
                  <text
                    x={chart.width - chart.padRight + 4}
                    y={chart.targetY - 2}
                    className={styles.trendAxis}
                  >
                    Target
                  </text>
                  <text
                    x={chart.width - chart.padRight + 4}
                    y={chart.targetY + 12}
                    className={styles.trendAxis}
                  >
                    {TARGET_PAYROLL_PCT.toFixed(1)}%
                  </text>
                </>
              )}
              {chart.points.map((p, i) => {
                const start = addDays(currentWeekStart, -7 * (TREND_WEEKS - 1 - i));
                const label = `W${i + 1}`;
                const date = fmtWeekShortDate(start);
                const isLast = i === chart.points.length - 1;
                return (
                  <g key={`x-${i}`}>
                    <text x={p.x} y={chart.height - 14} className={isLast ? styles.trendXLast : styles.trendX} textAnchor="middle">{label}</text>
                    <text x={p.x} y={chart.height - 2} className={isLast ? styles.trendXLast : styles.trendX} textAnchor="middle">{date}</text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>

      </section>
    </div>
  );
}

/* ── Trend chart geometry helper ── */

/* ── Week calendar picker ── */

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAY_HEADERS = ["M", "T", "W", "T", "F", "S", "S"];

function RangeCalendarPicker({
  rangeStartISO,
  rangeEndISO,
  onSelect,
}: {
  rangeStartISO: string;
  rangeEndISO: string;
  onSelect: (startISO: string, endISO: string) => void;
}) {
  // Cursor starts on the month of the currently-selected range start.
  const [cursor, setCursor] = useState<Date>(() => {
    const [y, m, d] = rangeStartISO.split("-").map(Number);
    return new Date(y, m - 1, d);
  });

  const committedStart = useMemo(() => {
    const [y, m, d] = rangeStartISO.split("-").map(Number);
    return new Date(y, m - 1, d);
  }, [rangeStartISO]);
  const committedEnd = useMemo(() => {
    const [y, m, d] = rangeEndISO.split("-").map(Number);
    return new Date(y, m - 1, d);
  }, [rangeEndISO]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISOStr = isoDate(today);
  // Any week whose Monday >= todayWeekStart is disabled (current week + future).
  const todayWeekStart = startOfWeekMon(today);

  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const gridStart = startOfWeekMon(first);
    const out: Array<{ date: Date; iso: string; inMonth: boolean }> = [];
    for (let i = 0; i < 42; i += 1) {
      const d = addDays(gridStart, i);
      out.push({ date: d, iso: isoDate(d), inMonth: d.getMonth() === cursor.getMonth() });
    }
    return out;
  }, [cursor]);

  // A cell is disabled if its week (Monday) is >= the current week's Monday.
  function isDisabled(date: Date): boolean {
    return startOfWeekMon(date) >= todayWeekStart;
  }

  // Single-click selects the full Mon–Sun week containing the clicked date.
  function pick(date: Date) {
    if (isDisabled(date)) return;
    const monday = startOfWeekMon(date);
    const sunday = addDays(monday, 6);
    onSelect(isoDate(monday), isoDate(sunday));
  }

  function gotoMonth(delta: number) {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
  }

  function isInRange(d: Date): boolean {
    return d >= committedStart && d <= committedEnd;
  }
  function isRangeEdge(d: Date): "start" | "end" | "single" | null {
    const isStart = d.getTime() === committedStart.getTime();
    const isEnd = d.getTime() === committedEnd.getTime();
    if (isStart && isEnd) return "single";
    if (isStart) return "start";
    if (isEnd) return "end";
    return null;
  }

  return (
    <div className={styles.weekCal} role="dialog" aria-label="Select a week">
      <div className={styles.weekCalHead}>
        <button type="button" className={styles.weekCalNav} onClick={() => gotoMonth(-1)} aria-label="Previous month">‹</button>
        <span className={styles.weekCalMonth}>{MONTH_NAMES[cursor.getMonth()]} {cursor.getFullYear()}</span>
        <button type="button" className={styles.weekCalNav} onClick={() => gotoMonth(1)} aria-label="Next month">›</button>
      </div>
      <div className={styles.weekCalWeekdays}>
        {WEEKDAY_HEADERS.map((w, idx) => (
          <span key={idx} className={styles.weekCalWeekday}>{w}</span>
        ))}
      </div>
      <div className={styles.weekCalGrid}>
        {cells.map(({ date, iso, inMonth }) => {
          const disabled = isDisabled(date);
          const inSel = !disabled && isInRange(date);
          const edge = !disabled ? isRangeEdge(date) : null;
          const isToday = iso === todayISOStr;
          return (
            <button
              key={iso}
              type="button"
              onClick={() => pick(date)}
              disabled={disabled}
              className={[
                styles.weekCalCell,
                inSel ? styles.weekCalCellSelected : "",
                !inMonth ? styles.weekCalCellOut : "",
                isToday ? styles.weekCalCellToday : "",
                edge === "start" ? styles.weekCalCellEdgeStart : "",
                edge === "end" ? styles.weekCalCellEdgeEnd : "",
                edge === "single" ? styles.weekCalCellEdgeSingle : "",
                disabled ? styles.weekCalCellDisabled : "",
              ].filter(Boolean).join(" ")}
              aria-pressed={inSel}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
      <p className={styles.weekCalHint}>Tap any date to select that full Mon–Sun week.</p>
    </div>
  );
}

function buildTrendChart(
  data: (WeekStats & { displayCost?: number; isActual?: boolean; pct?: number | null })[],
  pctMode: boolean,
  targetPct: number,
): {
  width: number;
  height: number;
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
  yLabels: { value: number; y: number; isTarget?: boolean }[];
  linePath: string;
  points: { x: number; y: number | null; value: number | null; isActual: boolean }[];
  pctMode: boolean;
  targetY: number | null;
} {
  const width = 360;
  const height = 220;
  const padLeft = 52;
  const padRight = 56;
  const padTop = 16;
  const padBottom = 38;
  const xSpan = width - padLeft - padRight;

  if (pctMode) {
    const pctValues = data.map((w) => w.pct ?? 0).filter((v) => v > 0);
    const maxRaw = Math.max(...pctValues, targetPct + 5);
    const minRaw = Math.min(...pctValues, targetPct - 3);
    const yMax = Math.ceil(maxRaw / 2) * 2;
    const yMin = Math.max(0, Math.floor(minRaw / 2) * 2);
    const tickStep = Math.max(2, Math.round((yMax - yMin) / 4 / 2) * 2);
    const yLabels: { value: number; y: number; isTarget?: boolean }[] = [];
    for (let v = yMax; v >= yMin; v -= tickStep) {
      yLabels.push({
        value: v,
        y: padTop + ((yMax - v) / (yMax - yMin)) * (height - padTop - padBottom),
      });
    }
    // Inject the target line as an extra label if it isn't already present.
    if (!yLabels.some((l) => l.value === targetPct)) {
      yLabels.push({
        value: targetPct,
        y: padTop + ((yMax - targetPct) / (yMax - yMin)) * (height - padTop - padBottom),
        isTarget: true,
      });
    } else {
      const t = yLabels.find((l) => l.value === targetPct);
      if (t) t.isTarget = true;
    }
    const targetY = padTop + ((yMax - targetPct) / (yMax - yMin)) * (height - padTop - padBottom);

    const points = data.map((d, i) => {
      if (d.pct === null || d.pct === undefined || d.pct <= 0) {
        return {
          x: padLeft + (data.length === 1 ? xSpan / 2 : (i / (data.length - 1)) * xSpan),
          y: null,
          value: null,
          isActual: !!d.isActual,
        };
      }
      return {
        x: padLeft + (data.length === 1 ? xSpan / 2 : (i / (data.length - 1)) * xSpan),
        y: padTop + ((yMax - d.pct) / (yMax - yMin)) * (height - padTop - padBottom),
        value: d.pct,
        isActual: !!d.isActual,
      };
    });
    // Build a path that breaks when a point is missing.
    let linePath = "";
    let drawingFromStart = true;
    for (const p of points) {
      if (p.y === null) {
        drawingFromStart = true;
        continue;
      }
      linePath += `${drawingFromStart ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)} `;
      drawingFromStart = false;
    }
    return { width, height, padLeft, padRight, padTop, padBottom, yLabels, linePath: linePath.trim(), points, pctMode: true, targetY };
  }

  // Fallback: estimated cost chart (used until a week has Square sales).
  const values = data.map((w) => w.displayCost ?? w.estimatedCost);
  const maxRaw = Math.max(...values, 1);
  const yMax = Math.ceil(maxRaw / 1000) * 1000 || 1000;
  const yMin = 0;
  const tickStep = Math.max(1000, Math.round(yMax / 4 / 1000) * 1000);
  const yLabels: { value: number; y: number; isTarget?: boolean }[] = [];
  for (let v = yMax; v >= yMin; v -= tickStep) {
    yLabels.push({
      value: v,
      y: padTop + ((yMax - v) / (yMax - yMin)) * (height - padTop - padBottom),
    });
  }
  const points = data.map((d, i) => {
    const v = d.displayCost ?? d.estimatedCost;
    return {
      x: padLeft + (data.length === 1 ? xSpan / 2 : (i / (data.length - 1)) * xSpan),
      y: padTop + ((yMax - v) / (yMax - yMin)) * (height - padTop - padBottom),
      value: v,
      isActual: !!d.isActual,
    };
  });
  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y!.toFixed(1)}`)
    .join(" ");
  return { width, height, padLeft, padRight, padTop, padBottom, yLabels, linePath, points, pctMode: false, targetY: null };
}
