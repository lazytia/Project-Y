"use client";

import { useEffect, useMemo, useState } from "react";
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
const LUNCH_HOURS = 4;
const DINNER_HOURS = 5;
const TREND_WEEKS = 4; // current + previous 3

type Meal = "lunch" | "dinner";

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

function aggregateWeek(weekStart: Date, doc: WeekDoc | undefined): WeekStats {
  const stats: WeekStats = {
    weekStartISO: isoDate(weekStart),
    totalShifts: 0,
    estimatedCost: 0,
    byDay: {},
  };
  for (let i = 0; i < 7; i += 1) {
    const d = addDays(weekStart, i);
    const iso = isoDate(d);
    const lunchKeys = Object.keys(doc?.assignments?.[iso]?.lunch ?? {});
    const dinnerKeys = Object.keys(doc?.assignments?.[iso]?.dinner ?? {});
    const lunchShifts = lunchKeys.length;
    const dinnerShifts = dinnerKeys.length;
    const cost =
      lunchShifts * LUNCH_HOURS * EST_HOURLY_RATE +
      dinnerShifts * DINNER_HOURS * EST_HOURLY_RATE;
    stats.byDay[iso] = { shifts: lunchShifts + dinnerShifts, cost };
    stats.totalShifts += lunchShifts + dinnerShifts;
    stats.estimatedCost += cost;
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

  const [selectedWeekISO, setSelectedWeekISO] = useState<string>(() => isoDate(startOfWeekMon(new Date())));
  const [weekPickerOpen, setWeekPickerOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const currentWeekStart = useMemo(() => {
    const [y, m, d] = selectedWeekISO.split("-").map(Number);
    if (!y || !m || !d) return todayWeekStart;
    return new Date(y, m - 1, d);
  }, [selectedWeekISO, todayWeekStart]);
  const prevWeekStart = useMemo(() => addDays(currentWeekStart, -7), [currentWeekStart]);

  // Build the list of weeks the manager can pick — every week that has
  // an entry in rosters_published, plus the current week as a fallback.
  const weekOptions = useMemo(() => {
    const set = new Set<string>(Object.keys(docs));
    set.add(isoDate(todayWeekStart));
    // Also include the 8 most recent weeks for navigation.
    for (let i = 0; i < 8; i += 1) set.add(isoDate(addDays(todayWeekStart, -7 * i)));
    return Array.from(set)
      .sort((a, b) => (a < b ? 1 : -1));
  }, [docs, todayWeekStart]);

  // Aggregations
  const currentWeek = useMemo(
    () => aggregateWeek(currentWeekStart, docs[isoDate(currentWeekStart)]),
    [currentWeekStart, docs],
  );
  const prevWeek = useMemo(
    () => aggregateWeek(prevWeekStart, docs[isoDate(prevWeekStart)]),
    [prevWeekStart, docs],
  );

  // Trend (last TREND_WEEKS including current)
  const trend = useMemo(() => {
    const out: WeekStats[] = [];
    for (let i = TREND_WEEKS - 1; i >= 0; i -= 1) {
      const start = addDays(currentWeekStart, -7 * i);
      out.push(aggregateWeek(start, docs[isoDate(start)]));
    }
    return out;
  }, [currentWeekStart, docs]);

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

  // Square Gross Sales for this and the previous week.
  const sales = salesMap[isoDate(currentWeekStart)]?.grossSales ?? 0;
  const prevSales = salesMap[isoDate(prevWeekStart)]?.grossSales ?? 0;
  const hasSales = sales > 0;
  const salesVsLast = prevSales > 0 ? ((sales - prevSales) / prevSales) * 100 : 0;
  const payrollPct = hasSales ? (payrollCost / sales) * 100 : 0;
  const prevPayrollPct = hasSales ? (prevPayrollCost / sales) * 100 : 0;
  const overTarget = hasSales && payrollPct > TARGET_PAYROLL_PCT;

  // Highest cost day
  const highestDay = useMemo(() => {
    let best: { iso: string; date: Date; cost: number; shifts: number } | null = null;
    for (let i = 0; i < 7; i += 1) {
      const d = addDays(currentWeekStart, i);
      const iso = isoDate(d);
      const day = currentWeek.byDay[iso];
      if (!day) continue;
      if (!best || day.cost > best.cost) {
        best = { iso, date: d, cost: day.cost, shifts: day.shifts };
      }
    }
    return best;
  }, [currentWeek, currentWeekStart]);

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

  // Auto-sync when the page first loads (and when the manager picks
  // a different week). Runs in the background — the existing
  // Firestore-read pass renders any stale data immediately so the
  // page never blocks on Square / Xero round-trips.
  const autoSyncedFor = useState<Set<string>>(() => new Set())[0];
  useEffect(() => {
    if (authLoading || loading || !user || !allowed) return;
    if (refreshing) return;
    if (autoSyncedFor.has(selectedWeekISO)) return;
    autoSyncedFor.add(selectedWeekISO);
    // Defer to the next tick so the initial Splash → page render
    // finishes before we kick off the heavier sync call.
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
      // Surface what each integration returned so we can see why a 200
      // response can still leave the cards blank (Square location wrong,
      // no orders for that week, Xero not connected yet, etc.).
      const sq = data?.square;
      const xe = data?.xero;
      const sqMsg = sq?.error
        ? `Square: ${sq.error}`
        : typeof sq?.grossSales === "number"
          ? `Square: $${sq.grossSales.toFixed(2)} (${sq.days} days)`
          : "Square: no response";
      const xeMsg = xe === null
        ? "Xero: not connected yet — visit /api/xero/connect"
        : xe?.error
          ? `Xero: ${xe.error}`
          : typeof xe?.gross === "number"
            ? `Xero: gross $${xe.gross}, super $${xe.super}`
            : "Xero: no matching pay run for that week";
      setRefreshError(`${sqMsg}  |  ${xeMsg}`);
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

      {refreshError && (
        <p style={{ fontSize: 12, color: refreshError.startsWith("Square:") ? "#1f8d5f" : "#c14545", textAlign: "center", margin: 0, padding: "0 8px", lineHeight: 1.4 }}>
          {refreshError}
        </p>
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
            <span>{fmtRange(currentWeekStart, weekEnd)}</span>
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
              <ul className={styles.weekMenu} role="listbox">
                {weekOptions.map((iso) => {
                  const [y, m, d] = iso.split("-").map(Number);
                  const start = new Date(y, m - 1, d);
                  const end = addDays(start, 5);
                  const isCurrent = iso === selectedWeekISO;
                  const isThisWeek = iso === isoDate(todayWeekStart);
                  return (
                    <li key={iso}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={isCurrent}
                        className={`${styles.weekOption} ${isCurrent ? styles.weekOptionActive : ""}`}
                        onClick={() => {
                          setSelectedWeekISO(iso);
                          setWeekPickerOpen(false);
                        }}
                      >
                        <span>{fmtRange(start, end)}</span>
                        {isThisWeek && <span className={styles.weekOptionBadge}>This week</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </div>

      {/* Snapshot card */}
      <section className={styles.snapshot}>
        <div className={styles.snapshotCol}>
          <p className={styles.snapshotLabel}>SALES</p>
          <p className={styles.snapshotValue}>{hasSales ? fmtCurrency(sales) : "—"}</p>
          <p className={styles.snapshotMeta}>
            {hasSales
              ? prevSales > 0
                ? `${salesVsLast >= 0 ? "+" : ""}${fmtPct(salesVsLast)} vs last week`
                : "Gross sales (Square)"
              : "Not connected"}
          </p>
        </div>
        <div className={styles.snapshotDivider} />
        <div className={styles.snapshotCol}>
          <p className={styles.snapshotLabel}>PAYROLL %</p>
          <p className={`${styles.snapshotValue} ${overTarget ? styles.snapshotValueDanger : styles.snapshotValueWarm}`}>
            {hasSales ? fmtPct(payrollPct) : "—"}
          </p>
          {hasSales ? (
            <span className={`${styles.targetPill} ${overTarget ? styles.targetPillDanger : styles.targetPillOk}`}>
              <span className={styles.targetIcon} aria-hidden="true">
                {overTarget ? (
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
              {overTarget ? "Over Target" : "Under Target"}
            </span>
          ) : (
            <span className={styles.snapshotMeta}>Needs sales data</span>
          )}
          <p className={styles.snapshotTargetLine}>Target {fmtPct(TARGET_PAYROLL_PCT)}</p>
        </div>
        <div className={styles.snapshotDivider} />
        <div className={styles.snapshotCol}>
          <p className={styles.snapshotLabel}>PAYROLL COST</p>
          <p className={styles.snapshotValue}>{fmtCurrency(payrollCost)}</p>
          <p className={styles.snapshotMeta}>
            {prevPayrollCost > 0
              ? `${payrollVsLast >= 0 ? "+" : ""}${fmtPct(payrollVsLast)} vs last week`
              : payrollIsActual ? "Actual incl. super" : "Estimated"}
          </p>
          {payrollIsActual && (
            <span className={styles.sourcePill}>From Xero</span>
          )}
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
              PAYROLL COST (ACTUAL){payrollIsActual && <span className={styles.pvaSource}> · Xero</span>}
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

      {/* Labour trend + highest cost day */}
      <section className={styles.twoCol}>
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

        <div className={`${styles.card} ${styles.highCard}`}>
          <p className={styles.cardTitle}>HIGHEST COST DAY</p>
          {highestDay ? (
            <>
              <p className={styles.highDay}>{fmtDayLong(highestDay.date)}</p>
              <div className={styles.highRow}>
                <p className={styles.highLabel}>Sales $</p>
                <p className={styles.highValue}>
                  {hasSales ? fmtCurrency(sales / 6) : "—"}
                </p>
              </div>
              <div className={styles.highRow}>
                <p className={styles.highLabel}>Payroll $</p>
                <p className={styles.highValue}>{fmtCurrency(highestDay.cost)}</p>
              </div>
              <div className={styles.highDivider} />
              <p className={styles.highLabel}>SHARE OF WEEK</p>
              <p className={`${styles.highPct} ${currentWeek.estimatedCost > 0 && (highestDay.cost / currentWeek.estimatedCost) > 0.3 ? styles.highPctDanger : styles.highPctWarm}`}>
                {currentWeek.estimatedCost > 0
                  ? fmtPct((highestDay.cost / currentWeek.estimatedCost) * 100)
                  : "—"}
              </p>
            </>
          ) : (
            <p className={styles.emptyChart}>No shifts rostered yet this week.</p>
          )}
        </div>
      </section>

      {/* Insights */}
      <section className={styles.card}>
        <p className={styles.cardTitle}>
          <span className={styles.sparkle} aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8z" />
            </svg>
          </span>
          INSIGHTS
        </p>
        <ul className={styles.insightList}>
          <li>
            {payrollIsActual ? "Actual payroll" : "Estimated payroll"} for the week:{" "}
            {fmtCurrency(payrollCost)}
            {payrollIsActual ? " (incl. super, from Xero)" : ""} across {currentWeek.totalShifts} shifts.
          </li>
          {prevPayrollCost > 0 && (
            <li>
              Estimated payroll {payrollVsLast >= 0 ? "increased" : "decreased"} by {fmtPct(Math.abs(payrollVsLast))} vs last week.
            </li>
          )}
          {highestDay && (
            <li>
              {fmtDayLong(highestDay.date)} is currently the busiest day ({highestDay.shifts} shifts).
            </li>
          )}
          {!hasSales && (
            <li className={styles.insightMuted}>
              Sales integration not connected — Payroll % and target comparison will activate once sales data is wired.
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}

/* ── Trend chart geometry helper ── */

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
