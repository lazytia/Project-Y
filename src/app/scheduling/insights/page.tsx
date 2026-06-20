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
      } finally {
        setLoading(false);
      }
    })();
  }, [authLoading, allowed, router]);

  // Week anchors
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const currentWeekStart = useMemo(() => startOfWeekMon(today), [today]);
  const prevWeekStart = useMemo(() => addDays(currentWeekStart, -7), [currentWeekStart]);

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

  // Derived
  const payrollCost = currentWeek.estimatedCost;
  const prevPayrollCost = prevWeek.estimatedCost;
  const rosterPlanned = payrollCost; // same source for now
  const variance = payrollCost - rosterPlanned;

  // Sales — no source yet. Use a global config doc later; for now, "—".
  const sales = 0;
  const hasSales = sales > 0;
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

  // Trend chart geometry — show payroll cost trend (estimated)
  const chart = useMemo(() => buildTrendChart(trend), [trend]);

  // Comparison labels
  const compareSales = prevPayrollCost > 0
    ? ((payrollCost - prevPayrollCost) / prevPayrollCost) * 100
    : 0;

  // SALES delta vs last week — we don't have sales yet
  // PAYROLL COST delta
  const payrollVsLast = compareSales;

  const weekEnd = useMemo(() => addDays(currentWeekStart, 5), [currentWeekStart]); // Mon→Sat
  const prevWeekEnd = useMemo(() => addDays(prevWeekStart, 5), [prevWeekStart]);

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
        <button type="button" className={styles.iconBtn} aria-label="Pick date range">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </button>
      </header>

      <div className={styles.weekRow}>
        <span className={styles.weekPill}>
          <span>{fmtRange(currentWeekStart, weekEnd)}</span>
          <span className={styles.weekChev}>▾</span>
        </span>
        <p className={styles.weekCompare}>Compared to {fmtRange(prevWeekStart, prevWeekEnd)}</p>
      </div>

      {/* Snapshot card */}
      <section className={styles.snapshot}>
        <div className={styles.snapshotCol}>
          <p className={styles.snapshotLabel}>SALES</p>
          <p className={styles.snapshotValue}>{hasSales ? fmtCurrency(sales) : "—"}</p>
          <p className={styles.snapshotMeta}>
            {hasSales ? "vs last week" : "Not connected"}
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
              : "Estimated"}
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
            <p className={styles.pvaLabel}>PAYROLL COST (ACTUAL)</p>
            <p className={`${styles.pvaValue} ${styles.pvaValueWarm}`}>{fmtCurrency(payrollCost)}</p>
            <p className={styles.pvaMeta}>{hasSales ? `${fmtPct(payrollPct)} of sales` : "Estimated"}</p>
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
            LABOUR TREND <span className={styles.cardTitleSub}>(EST. COST)</span>
          </p>
          {chart.points.every((p) => p.value === 0) ? (
            <p className={styles.emptyChart}>No roster data for the last {TREND_WEEKS} weeks.</p>
          ) : (
            <svg className={styles.trendSvg} viewBox={`0 0 ${chart.width} ${chart.height}`} preserveAspectRatio="none">
              {chart.yLabels.map((y) => (
                <text key={y.value} x={chart.padLeft - 6} y={y.y + 3} className={styles.trendAxis} textAnchor="end">
                  {fmtCurrency(y.value)}
                </text>
              ))}
              <path d={chart.linePath} className={styles.trendLine} />
              {chart.points.map((p, i) => (
                <g key={i}>
                  <circle cx={p.x} cy={p.y} r={3.5} className={styles.trendDot} />
                  <text x={p.x + 10} y={p.y - 6} className={styles.trendValue}>
                    {fmtCurrency(p.value)}
                  </text>
                </g>
              ))}
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
                <p className={styles.highLabel}>SHIFTS</p>
                <p className={styles.highValue}>{highestDay.shifts}</p>
              </div>
              <div className={styles.highRow}>
                <p className={styles.highLabel}>EST. PAYROLL</p>
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
            Estimated payroll for the week: {fmtCurrency(payrollCost)} across {currentWeek.totalShifts} shifts.
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
  data: WeekStats[],
): {
  width: number;
  height: number;
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
  yLabels: { value: number; y: number }[];
  linePath: string;
  points: { x: number; y: number; value: number }[];
} {
  const width = 360;
  const height = 220;
  const padLeft = 56;
  const padRight = 32;
  const padTop = 16;
  const padBottom = 38;
  const values = data.map((w) => w.estimatedCost);
  const maxRaw = Math.max(...values, 1);
  const yMax = Math.ceil(maxRaw / 1000) * 1000 || 1000;
  const yMin = 0;
  const tickStep = Math.max(1000, Math.round(yMax / 4 / 1000) * 1000);
  const yLabels: { value: number; y: number }[] = [];
  for (let v = yMax; v >= yMin; v -= tickStep) {
    yLabels.push({
      value: v,
      y: padTop + ((yMax - v) / (yMax - yMin)) * (height - padTop - padBottom),
    });
  }
  const xSpan = width - padLeft - padRight;
  const points = data.map((d, i) => ({
    x: padLeft + (data.length === 1 ? xSpan / 2 : (i / (data.length - 1)) * xSpan),
    y: padTop + ((yMax - d.estimatedCost) / (yMax - yMin)) * (height - padTop - padBottom),
    value: d.estimatedCost,
  }));
  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  return { width, height, padLeft, padRight, padTop, padBottom, yLabels, linePath, points };
}
