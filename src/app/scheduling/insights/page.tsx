"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";

/* ──────────────────────────────────────────────────────────────────────
 * Roster Insight — owner/manager analytics dashboard.
 *
 * Hardcoded values for now (matching the design); the shape is what the
 * real Firestore aggregations will fill in once the roster publish flow
 * and Square sales pipeline land.
 * ──────────────────────────────────────────────────────────────────── */

const TARGET_PAYROLL_PCT = 25;

const WEEK_LABEL = "9 Jun – 15 Jun";
const PREV_WEEK_LABEL = "2 Jun – 8 Jun";

const SALES_TOTAL = 30240;
const SALES_VS_LAST = -2.4; // %

const PAYROLL_COST = 8240;
const PAYROLL_COST_VS_LAST = 3.1; // %

const ROSTER_PLANNED = 7600;

const HIGHEST_COST_DAY = {
  day: "Friday",
  sales: 6420,
  payroll: 1920,
};

const TREND: { week: string; date: string; pct: number }[] = [
  { week: "W1", date: "19 May", pct: 29.4 },
  { week: "W2", date: "26 May", pct: 27.8 },
  { week: "W3", date: "2 Jun", pct: 26.9 },
  { week: "W4", date: "9 Jun", pct: 27.2 },
];

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

export default function InsightsPage() {
  const router = useRouter();

  // Derived numbers
  const payrollPct = useMemo(
    () => (SALES_TOTAL > 0 ? (PAYROLL_COST / SALES_TOTAL) * 100 : 0),
    [],
  );
  const rosterPctOfSales = useMemo(
    () => (SALES_TOTAL > 0 ? (ROSTER_PLANNED / SALES_TOTAL) * 100 : 0),
    [],
  );
  const variance = PAYROLL_COST - ROSTER_PLANNED;
  const variancePctOfSales = useMemo(
    () => (SALES_TOTAL > 0 ? (variance / SALES_TOTAL) * 100 : 0),
    [variance],
  );

  const overTarget = payrollPct > TARGET_PAYROLL_PCT;

  const highestDayPct = useMemo(
    () => (HIGHEST_COST_DAY.sales > 0
      ? (HIGHEST_COST_DAY.payroll / HIGHEST_COST_DAY.sales) * 100
      : 0),
    [],
  );
  const weeklyAvgPct = useMemo(
    () => TREND.reduce((s, t) => s + t.pct, 0) / TREND.length,
    [],
  );
  const highestDayVsAvg = highestDayPct - weeklyAvgPct;

  // SVG trend chart geometry
  const chart = useMemo(() => buildTrendChart(TREND, TARGET_PAYROLL_PCT), []);

  const [weekOpen, setWeekOpen] = useState(false);

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
        <button
          type="button"
          className={styles.weekPill}
          onClick={() => setWeekOpen((s) => !s)}
        >
          <span>{WEEK_LABEL}</span>
          <span className={`${styles.weekChev} ${weekOpen ? styles.weekChevOpen : ""}`}>▾</span>
        </button>
        <p className={styles.weekCompare}>Compared to {PREV_WEEK_LABEL}</p>
      </div>

      {/* Snapshot card */}
      <section className={styles.snapshot}>
        <div className={styles.snapshotCol}>
          <p className={styles.snapshotLabel}>SALES</p>
          <p className={styles.snapshotValue}>{fmtCurrency(SALES_TOTAL)}</p>
          <p className={styles.snapshotMeta}>
            {SALES_VS_LAST >= 0 ? "+" : ""}{fmtPct(SALES_VS_LAST)} vs last week
          </p>
        </div>
        <div className={styles.snapshotDivider} />
        <div className={styles.snapshotCol}>
          <p className={styles.snapshotLabel}>PAYROLL %</p>
          <p className={`${styles.snapshotValue} ${overTarget ? styles.snapshotValueDanger : styles.snapshotValueWarm}`}>
            {fmtPct(payrollPct)}
          </p>
          <span className={`${styles.targetPill} ${overTarget ? styles.targetPillDanger : styles.targetPillOk}`}>
            {overTarget ? (
              <>
                <span className={styles.targetIcon} aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="6" y1="6" x2="18" y2="18" />
                    <line x1="18" y1="6" x2="6" y2="18" />
                  </svg>
                </span>
                Over Target
              </>
            ) : (
              <>
                <span className={styles.targetIcon} aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
                Under Target
              </>
            )}
          </span>
          <p className={styles.snapshotTargetLine}>Target {fmtPct(TARGET_PAYROLL_PCT)}</p>
        </div>
        <div className={styles.snapshotDivider} />
        <div className={styles.snapshotCol}>
          <p className={styles.snapshotLabel}>PAYROLL COST</p>
          <p className={styles.snapshotValue}>{fmtCurrency(PAYROLL_COST)}</p>
          <p className={styles.snapshotMeta}>
            {PAYROLL_COST_VS_LAST >= 0 ? "+" : ""}{fmtPct(PAYROLL_COST_VS_LAST)} vs last week
          </p>
        </div>
      </section>

      {/* Planned vs Actual */}
      <section className={styles.card}>
        <p className={styles.cardTitle}>PLANNED VS ACTUAL</p>
        <div className={styles.pvaGrid}>
          <div className={styles.pvaCol}>
            <p className={styles.pvaLabel}>ROSTER COST (PLANNED)</p>
            <p className={styles.pvaValue}>{fmtCurrency(ROSTER_PLANNED)}</p>
            <p className={styles.pvaMeta}>{fmtPct(rosterPctOfSales)} of sales</p>
          </div>
          <span className={styles.pvaOp} aria-hidden="true">−</span>
          <div className={styles.pvaCol}>
            <p className={styles.pvaLabel}>PAYROLL COST (ACTUAL)</p>
            <p className={`${styles.pvaValue} ${styles.pvaValueWarm}`}>{fmtCurrency(PAYROLL_COST)}</p>
            <p className={styles.pvaMeta}>{fmtPct(payrollPct)} of sales</p>
          </div>
          <span className={styles.pvaOp} aria-hidden="true">=</span>
          <div className={styles.pvaCol}>
            <p className={styles.pvaLabel}>VARIANCE</p>
            <p className={`${styles.pvaValue} ${variance > 0 ? styles.pvaValueWarm : ""}`}>
              {variance >= 0 ? "+" : "−"}{fmtCurrency(Math.abs(variance))}
            </p>
            <p className={styles.pvaMeta}>
              {variancePctOfSales >= 0 ? "+" : ""}{fmtPct(variancePctOfSales)} of sales
            </p>
          </div>
        </div>
      </section>

      {/* Labour trend + highest cost day */}
      <section className={styles.twoCol}>
        <div className={`${styles.card} ${styles.trendCard}`}>
          <p className={styles.cardTitle}>
            LABOUR TREND <span className={styles.cardTitleSub}>(PAYROLL %)</span>
          </p>
          <svg className={styles.trendSvg} viewBox={`0 0 ${chart.width} ${chart.height}`} preserveAspectRatio="none">
            {/* Y-axis labels */}
            {chart.yLabels.map((y) => (
              <text key={y.value} x={chart.padLeft - 6} y={y.y + 3} className={styles.trendAxis} textAnchor="end">
                {y.value}%
              </text>
            ))}
            {/* Target dashed line */}
            <line
              x1={chart.padLeft}
              x2={chart.width - chart.padRight}
              y1={chart.targetY}
              y2={chart.targetY}
              className={styles.trendTarget}
              strokeDasharray="4 4"
            />
            <text x={chart.width - chart.padRight - 2} y={chart.targetY - 6} className={styles.trendAxisRight} textAnchor="end">
              Target
            </text>
            <text x={chart.width - chart.padRight - 2} y={chart.targetY + 12} className={styles.trendAxisRight} textAnchor="end">
              {fmtPct(TARGET_PAYROLL_PCT, 1)}
            </text>
            {/* Line */}
            <path d={chart.linePath} className={styles.trendLine} />
            {/* Points + value labels */}
            {chart.points.map((p, i) => (
              <g key={i}>
                <circle cx={p.x} cy={p.y} r={3.5} className={styles.trendDot} />
                <text x={p.x + 10} y={p.y - 6} className={styles.trendValue}>{p.pct}%</text>
              </g>
            ))}
            {/* X labels */}
            {chart.points.map((p, i) => (
              <g key={`x-${i}`}>
                <text x={p.x} y={chart.height - 14} className={i === chart.points.length - 1 ? styles.trendXLast : styles.trendX} textAnchor="middle">
                  {TREND[i].week}
                </text>
                <text x={p.x} y={chart.height - 2} className={i === chart.points.length - 1 ? styles.trendXLast : styles.trendX} textAnchor="middle">
                  {TREND[i].date}
                </text>
              </g>
            ))}
          </svg>
        </div>

        <div className={`${styles.card} ${styles.highCard}`}>
          <p className={styles.cardTitle}>HIGHEST COST DAY</p>
          <p className={styles.highDay}>{HIGHEST_COST_DAY.day}</p>
          <div className={styles.highRow}>
            <p className={styles.highLabel}>SALES</p>
            <p className={styles.highValue}>{fmtCurrency(HIGHEST_COST_DAY.sales)}</p>
          </div>
          <div className={styles.highRow}>
            <p className={styles.highLabel}>PAYROLL</p>
            <p className={styles.highValue}>{fmtCurrency(HIGHEST_COST_DAY.payroll)}</p>
          </div>
          <div className={styles.highDivider} />
          <p className={styles.highLabel}>PAYROLL %</p>
          <p className={`${styles.highPct} ${highestDayPct > TARGET_PAYROLL_PCT ? styles.highPctDanger : styles.highPctWarm}`}>
            {fmtPct(highestDayPct)}
          </p>
          <p className={`${styles.highVsAvg} ${highestDayVsAvg > 0 ? styles.highVsAvgDanger : styles.highVsAvgWarm}`}>
            {highestDayVsAvg >= 0 ? "+" : ""}{fmtPct(highestDayVsAvg)} vs weekly avg
          </p>
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
            Payroll % was {overTarget ? "above" : "below"} target at {fmtPct(payrollPct)} (target {fmtPct(TARGET_PAYROLL_PCT)}).
          </li>
          <li>
            {HIGHEST_COST_DAY.day} labour cost was higher than usual due to overtime.
          </li>
          <li>
            Roster variance {variance >= 0 ? "increased" : "decreased"} by {fmtCurrency(Math.abs(variance))} compared to planned.
          </li>
        </ul>
      </section>
    </div>
  );
}

/* ── Trend chart geometry helper ── */

function buildTrendChart(
  data: { pct: number }[],
  target: number,
): {
  width: number;
  height: number;
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
  yLabels: { value: number; y: number }[];
  targetY: number;
  linePath: string;
  points: { x: number; y: number; pct: number }[];
} {
  const width = 360;
  const height = 220;
  const padLeft = 36;
  const padRight = 60;
  const padTop = 16;
  const padBottom = 38;
  const yMin = 22;
  const yMax = 30;
  const yLabels = [30, 28, 26, 25, 22].map((v) => ({
    value: v,
    y: padTop + ((yMax - v) / (yMax - yMin)) * (height - padTop - padBottom),
  }));
  const targetY = padTop + ((yMax - target) / (yMax - yMin)) * (height - padTop - padBottom);
  const xSpan = width - padLeft - padRight;
  const points = data.map((d, i) => ({
    x: padLeft + (data.length === 1 ? xSpan / 2 : (i / (data.length - 1)) * xSpan),
    y: padTop + ((yMax - d.pct) / (yMax - yMin)) * (height - padTop - padBottom),
    pct: d.pct,
  }));
  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  return { width, height, padLeft, padRight, padTop, padBottom, yLabels, targetY, linePath, points };
}
