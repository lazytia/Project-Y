"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, getDocs, query, where } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { isOwner } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

/**
 * Owner Sales overview — pulls from two data sources:
 *   1. Firestore `sales_daily/{yyyy-mm-dd}` for the weekly & yearly bar
 *      charts. Populated nightly by /api/insights/refresh, so it's fast
 *      and matches Square Web's "Gross Sales" column (verified in
 *      squareGrossSalesCents).
 *   2. /api/square/sales-categories for the donut + top-selling categories
 *      of the selected week. Uses the Square catalog to bucket line items
 *      by Category, aggregating grossSalesMoney (again the Web dashboard
 *      figure) rather than the post-discount total.
 */

const SYDNEY_TZ = "Australia/Sydney";
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/* ── Date helpers ── */

function sydneyTodayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: SYDNEY_TZ });
}

/** ISO date key for the Monday of the week containing `dateKey`. */
function isoMondayOf(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = (dt.getUTCDay() + 6) % 7; // Mon = 0
  dt.setUTCDate(dt.getUTCDate() - dow);
  return dt.toISOString().slice(0, 10);
}

function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function fmtRangeLabel(mondayISO: string): string {
  const sundayISO = addDaysISO(mondayISO, 6);
  const [my, mm, md] = mondayISO.split("-").map(Number);
  const [sy, sm, sd] = sundayISO.split("-").map(Number);
  const mon = new Date(Date.UTC(my, mm - 1, md, 12));
  const sun = new Date(Date.UTC(sy, sm - 1, sd, 12));
  const monPart =
    mon.getUTCMonth() === sun.getUTCMonth()
      ? String(md)
      : `${md} ${mon.toLocaleDateString("en-AU", { month: "short", timeZone: "UTC" })}`;
  const sunPart = sun.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `${monPart} – ${sunPart}`;
}

function fmtCurrency(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ── Types ── */

type StoredDaily = { dateISO?: string; grossSales?: number };
type DailyMap = Map<string, number>;

type CategoryRow = {
  name: string;
  sales: number;
  quantity: number;
  deltaPct: number | null;
};

/* ── Page ── */

export default function SalesPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwner(user);

  const [todayKey, setTodayKey] = useState<string>("");
  // Monday of the currently-viewed week.
  const [weekMondayISO, setWeekMondayISO] = useState<string>("");
  const [daily, setDaily] = useState<DailyMap | null>(null);
  const [categories, setCategories] = useState<CategoryRow[] | null>(null);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  // 2025 monthly totals from Square (Firestore's sales_daily hasn't been
  // backfilled that far; we hit Square directly for the comparison year).
  const [lastYearMonthly, setLastYearMonthly] = useState<number[] | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!allowed) router.replace(ROUTES.home);
  }, [allowed, authLoading, router]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = sydneyTodayKey();
    setTodayKey(key);
    setWeekMondayISO(isoMondayOf(key));
  }, []);

  // ── Firestore daily fetch — 2 years back covers weekly + monthly views.
  useEffect(() => {
    if (!allowed || !todayKey) return;
    let cancelled = false;
    (async () => {
      try {
        // sales_daily documents are keyed by "YYYY-MM-DD" but the schema
        // also has a dateISO field, so filter on that for a clean range.
        const [ty] = todayKey.split("-").map(Number);
        const startISO = `${ty - 1}-01-01`;
        const endISO = `${ty}-12-31`;
        const snap = await getDocs(
          query(
            collection(getDb(), "sales_daily"),
            where("dateISO", ">=", startISO),
            where("dateISO", "<=", endISO),
          ),
        );
        const map: DailyMap = new Map();
        snap.docs.forEach((d) => {
          const data = d.data() as StoredDaily;
          const iso = data.dateISO ?? d.id;
          const v = typeof data.grossSales === "number" ? data.grossSales : 0;
          map.set(iso, v);
        });
        if (!cancelled) setDaily(map);
      } catch (err) {
        console.error("[sales] daily fetch failed:", err);
        if (!cancelled) setDaily(new Map());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allowed, todayKey]);

  // ── Last-year monthly totals (Square direct — sales_daily may not have
  //    that far of a backfill). Runs once per todayKey change.
  useEffect(() => {
    if (!allowed || !todayKey) return;
    let cancelled = false;
    const lastYear = Number(todayKey.slice(0, 4)) - 1;
    (async () => {
      try {
        const res = await fetch(`/api/square/yearly-sales?year=${lastYear}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { monthly: number[] };
        if (!cancelled) setLastYearMonthly(data.monthly ?? new Array(12).fill(0));
      } catch (err) {
        console.error("[sales] last-year fetch failed:", err);
        if (!cancelled) setLastYearMonthly(new Array(12).fill(0));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allowed, todayKey]);

  // ── Categories fetch for the currently-selected week.
  useEffect(() => {
    if (!allowed || !weekMondayISO) return;
    let cancelled = false;
    const endISO = addDaysISO(weekMondayISO, 6);
    setCategories(null);
    setCategoriesError(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/square/sales-categories?startDate=${weekMondayISO}&endDate=${endISO}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { categories: CategoryRow[] };
        if (!cancelled) setCategories(data.categories ?? []);
      } catch (err) {
        console.error("[sales] categories fetch failed:", err);
        if (!cancelled) {
          setCategories([]);
          setCategoriesError(err instanceof Error ? err.message : "Failed to load categories");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allowed, weekMondayISO]);

  /* ── Derived: weekly bars ── */
  const weekly = useMemo(() => {
    if (!daily || !weekMondayISO) return null;
    const prevMonday = addDaysISO(weekMondayISO, -7);
    const thisWeek: number[] = [];
    const lastWeek: number[] = [];
    for (let i = 0; i < 7; i++) {
      thisWeek.push(daily.get(addDaysISO(weekMondayISO, i)) ?? 0);
      lastWeek.push(daily.get(addDaysISO(prevMonday, i)) ?? 0);
    }
    const thisTotal = thisWeek.reduce((s, v) => s + v, 0);
    const lastTotal = lastWeek.reduce((s, v) => s + v, 0);
    const deltaPct = lastTotal > 0 ? ((thisTotal - lastTotal) / lastTotal) * 100 : null;
    return { thisWeek, lastWeek, thisTotal, lastTotal, deltaPct };
  }, [daily, weekMondayISO]);

  /* ── Derived: yearly monthly bars ──
   *   This year: bucketed from Firestore sales_daily (fresh nightly cache).
   *   Last year: whatever the /yearly-sales API returned — falls back to
   *   sales_daily for old backfills, and to zeros while loading. */
  const yearly = useMemo(() => {
    if (!daily || !todayKey) return null;
    const [ty] = todayKey.split("-").map(Number);
    const thisYear = new Array(12).fill(0);
    const lastYearFromDaily = new Array(12).fill(0);
    for (const [iso, val] of daily) {
      const [yy, mm] = iso.split("-").map(Number);
      if (yy === ty) thisYear[mm - 1] += val;
      else if (yy === ty - 1) lastYearFromDaily[mm - 1] += val;
    }
    // Prefer the /yearly-sales API data (has the whole year even without
    // sales_daily backfill); fall back to Firestore per-month if API
    // hasn't returned yet.
    const lastYear = lastYearMonthly ?? lastYearFromDaily;
    const thisYtd = thisYear.reduce((s, v) => s + v, 0);
    const lastYtd = lastYear.reduce((s, v) => s + v, 0);
    const deltaPct = lastYtd > 0 ? ((thisYtd - lastYtd) / lastYtd) * 100 : null;
    return { thisYear, lastYear, thisYtd, lastYtd, deltaPct };
  }, [daily, todayKey, lastYearMonthly]);

  const totalCategorySales = useMemo(
    () => (categories ?? []).reduce((s, c) => s + c.sales, 0),
    [categories],
  );

  if (authLoading || !allowed) return <Splash />;

  const loading = daily === null;

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <button
          type="button"
          className={styles.backBtn}
          onClick={() => router.back()}
          aria-label="Back"
        >
          <ChevronLeft />
        </button>
        <div className={styles.headerTitles}>
          <h1 className={styles.pageTitle}>Sales</h1>
          <p className={styles.pageSubtitle}>Overview of your sales performance.</p>
        </div>
        <button type="button" className={styles.datePill}>
          <CalendarIcon />
          <span className={styles.datePillLabel}>
            {weekMondayISO ? fmtRangeLabel(weekMondayISO) : "—"}
          </span>
          <span className={styles.datePillChevron} aria-hidden="true">▾</span>
        </button>
      </header>

      {/* ── This Week vs Last Week ── */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <p className={styles.cardTitle}>THIS WEEK vs LAST WEEK</p>
        </div>
        <div className={styles.numberRow}>
          <div>
            <p className={styles.numberLabel}>
              {weekMondayISO ? fmtRangeLabel(weekMondayISO) : "—"}
            </p>
            <p className={`${styles.numberValue} ${styles.numberValuePrimary}`}>
              {weekly ? fmtCurrency(weekly.thisTotal) : "—"}
            </p>
          </div>
          <div>
            <p className={styles.numberLabel}>Previous Week</p>
            <p className={styles.numberValueMuted}>
              {weekly ? fmtCurrency(weekly.lastTotal) : "—"}
            </p>
          </div>
          <div className={styles.deltaWrap}>
            {weekly && weekly.deltaPct !== null && (
              <>
                <p
                  className={`${styles.deltaValue} ${
                    weekly.deltaPct >= 0 ? styles.deltaUp : styles.deltaDown
                  }`}
                >
                  {weekly.deltaPct >= 0 ? "↑" : "↓"} {Math.abs(weekly.deltaPct).toFixed(1)}%
                </p>
                <p className={styles.deltaSub}>vs last week</p>
              </>
            )}
          </div>
        </div>
        <BarChart
          groups={weekly ? [weekly.thisWeek, weekly.lastWeek] : null}
          labels={[...DAY_LABELS]}
          seriesLabels={["This Week", "Last Week"]}
          seriesColors={["primary", "muted"]}
          loading={loading}
        />
      </section>

      {/* ── This Year vs Last Year ── */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <p className={styles.cardTitle}>THIS YEAR vs LAST YEAR</p>
        </div>
        <div className={styles.numberRow}>
          <div>
            <p className={styles.numberLabel}>
              {todayKey ? `${todayKey.slice(0, 4)} (YTD)` : "—"}
            </p>
            <p className={`${styles.numberValue} ${styles.numberValuePrimary}`}>
              {yearly ? fmtCurrency(yearly.thisYtd) : "—"}
            </p>
          </div>
          <div>
            <p className={styles.numberLabel}>
              {todayKey ? `${Number(todayKey.slice(0, 4)) - 1} (YTD)` : "—"}
            </p>
            <p className={styles.numberValueMuted}>
              {yearly ? fmtCurrency(yearly.lastYtd) : "—"}
            </p>
          </div>
          <div className={styles.deltaWrap}>
            {yearly && yearly.deltaPct !== null && (
              <>
                <p
                  className={`${styles.deltaValue} ${
                    yearly.deltaPct >= 0 ? styles.deltaUp : styles.deltaDown
                  }`}
                >
                  {yearly.deltaPct >= 0 ? "↑" : "↓"} {Math.abs(yearly.deltaPct).toFixed(1)}%
                </p>
                <p className={styles.deltaSub}>vs last year</p>
              </>
            )}
          </div>
        </div>
        <BarChart
          groups={yearly ? [yearly.thisYear, yearly.lastYear] : null}
          labels={[...MONTH_LABELS]}
          seriesLabels={[
            todayKey ? todayKey.slice(0, 4) : "This",
            todayKey ? String(Number(todayKey.slice(0, 4)) - 1) : "Last",
          ]}
          seriesColors={["primary", "muted"]}
          loading={loading}
        />
      </section>

      {/* ── Sales by Category ── */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <p className={styles.cardTitle}>SALES BY CATEGORY</p>
        </div>
        <div className={styles.categoryBody}>
          <DonutChart
            slices={(categories ?? []).map((c) => c.sales)}
            centerLabel="Total"
            centerValue={fmtCurrency(totalCategorySales)}
            loading={categories === null}
          />
          <ul className={styles.categoryList}>
            {(categories ?? []).slice(0, 6).map((c, idx) => (
              <li key={c.name} className={styles.categoryRow}>
                <span
                  className={styles.categoryDot}
                  style={{ background: donutColorAt(idx) }}
                  aria-hidden="true"
                />
                <span className={styles.categoryName}>{c.name}</span>
                <span className={styles.categoryValue}>{fmtCurrency(c.sales)}</span>
                <span
                  className={
                    c.deltaPct === null || c.deltaPct >= 0
                      ? styles.categoryDeltaUp
                      : styles.categoryDeltaDown
                  }
                >
                  {c.deltaPct === null
                    ? "—"
                    : `${c.deltaPct >= 0 ? "↑" : "↓"} ${Math.abs(c.deltaPct).toFixed(1)}%`}
                </span>
              </li>
            ))}
            {categories && categories.length === 0 && !categoriesError && (
              <li className={styles.emptyRow}>No category sales in this week yet.</li>
            )}
            {categoriesError && <li className={styles.emptyRow}>{categoriesError}</li>}
          </ul>
        </div>
        <p className={styles.categoryFoot}>vs previous week</p>
      </section>

      {/* ── Best Selling Categories — horizontal card row ── */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <p className={styles.cardTitle}>BEST SELLING CATEGORIES</p>
        </div>
        {categories && categories.length === 0 ? (
          <p className={styles.emptyRow}>No sales this week yet.</p>
        ) : (
          <div className={styles.bestScroller}>
            <ul className={styles.bestGrid}>
              {(categories ?? []).slice(0, 5).map((c, idx) => (
                <li key={c.name} className={styles.bestCard}>
                  <span
                    className={idx === 0 ? styles.bestRankHot : styles.bestRank}
                    aria-hidden="true"
                  >
                    {idx + 1}
                  </span>
                  <span
                    className={styles.bestCardDot}
                    style={{ background: donutColorAt(idx) }}
                    aria-hidden="true"
                  />
                  <p className={styles.bestCardName}>{c.name}</p>
                  <p className={styles.bestCardSales}>{fmtCurrency(c.sales)}</p>
                  <p
                    className={
                      c.deltaPct === null || c.deltaPct >= 0
                        ? styles.bestCardDeltaUp
                        : styles.bestCardDeltaDown
                    }
                  >
                    {c.deltaPct === null
                      ? "—"
                      : `${c.deltaPct >= 0 ? "↑" : "↓"} ${Math.abs(c.deltaPct).toFixed(1)}%`}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

/* ── Bar chart ── */

function BarChart({
  groups,
  labels,
  seriesLabels,
  seriesColors,
  loading,
}: {
  groups: number[][] | null;
  labels: string[];
  seriesLabels: string[];
  seriesColors: ("primary" | "muted")[];
  loading: boolean;
}) {
  // niceScale rounds the max up to a friendly tick value so the y-axis
  // reads $0 / $1K / $2K / … or $0 / $20K / $40K / … instead of odd
  // numbers like $4,732.
  const { niceMax, ticks } = useMemo(() => {
    let raw = 0;
    if (groups) for (const g of groups) for (const v of g) if (v > raw) raw = v;
    if (raw <= 0) return { niceMax: 0, ticks: [0] };
    const targetTicks = 5;
    const rough = raw / targetTicks;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
    const residual = rough / magnitude;
    let step: number;
    if (residual <= 1) step = magnitude;
    else if (residual <= 2) step = 2 * magnitude;
    else if (residual <= 2.5) step = 2.5 * magnitude;
    else if (residual <= 5) step = 5 * magnitude;
    else step = 10 * magnitude;
    const niceMaxCalc = Math.ceil(raw / step) * step;
    const arr: number[] = [];
    for (let v = 0; v <= niceMaxCalc + 1e-9; v += step) arr.push(v);
    return { niceMax: niceMaxCalc, ticks: arr };
  }, [groups]);

  function fmtTick(v: number): string {
    if (v >= 1000) {
      const k = v / 1000;
      return "$" + (k >= 10 ? Math.round(k) : k.toFixed(k % 1 === 0 ? 0 : 1)) + "K";
    }
    return "$" + Math.round(v).toLocaleString("en-US");
  }

  return (
    <div className={styles.chart}>
      <div className={styles.chartPlot}>
        {/* Y-axis tick labels — rendered top-down so $max is at the top. */}
        <div className={styles.chartYAxis}>
          {[...ticks].reverse().map((t) => (
            <span key={t} className={styles.chartYTick}>{fmtTick(t)}</span>
          ))}
        </div>
        {/* Bars + horizontal gridlines. */}
        <div className={styles.chartBars}>
          <div className={styles.chartGrid} aria-hidden="true">
            {[...ticks].reverse().map((_, i) => (
              <span key={i} className={styles.chartGridLine} />
            ))}
          </div>
          {labels.map((lbl, i) => (
            <div key={lbl} className={styles.chartGroup}>
              <div className={styles.chartGroupBars}>
                {(groups ?? [[], []]).map((g, gi) => {
                  const value = g[i] ?? 0;
                  const height =
                    niceMax > 0 ? Math.max((value / niceMax) * 100, value > 0 ? 2 : 0) : 0;
                  return (
                    <div
                      key={gi}
                      className={
                        seriesColors[gi] === "primary"
                          ? styles.chartBarPrimary
                          : styles.chartBarMuted
                      }
                      style={{ height: `${height}%` }}
                      title={`${seriesLabels[gi]} ${lbl}: ${value ? fmtCurrency(value) : "—"}`}
                    />
                  );
                })}
              </div>
              <span className={styles.chartXLabel}>{lbl}</span>
            </div>
          ))}
        </div>
      </div>
      <div className={styles.chartLegend}>
        {seriesLabels.map((lbl, i) => (
          <span key={lbl} className={styles.legendItem}>
            <span
              className={
                seriesColors[i] === "primary" ? styles.legendSwatchPrimary : styles.legendSwatchMuted
              }
              aria-hidden="true"
            />
            {lbl}
          </span>
        ))}
      </div>
      {loading && <p className={styles.chartLoading}>Loading…</p>}
    </div>
  );
}

/* ── Donut chart ── */

const DONUT_COLORS = [
  "#FF6A13", // warm/orange — largest slice
  "#1f2937", // near-black
  "#6b7280", // gray
  "#d1d5db", // light gray
  "#f59e0b", // amber
  "#10b981", // green
] as const;

function donutColorAt(i: number): string {
  return DONUT_COLORS[i % DONUT_COLORS.length];
}

function DonutChart({
  slices,
  centerLabel,
  centerValue,
  loading,
}: {
  slices: number[];
  centerLabel: string;
  centerValue: string;
  loading: boolean;
}) {
  const total = slices.reduce((s, v) => s + v, 0);
  const radius = 60;
  const stroke = 22;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  const segments = slices.map((v, i) => {
    const fraction = total > 0 ? v / total : 0;
    const length = fraction * circumference;
    const seg = {
      color: donutColorAt(i),
      dashArray: `${length} ${circumference - length}`,
      dashOffset: -offset,
    };
    offset += length;
    return seg;
  });

  return (
    <div className={styles.donutWrap}>
      <svg
        viewBox="0 0 160 160"
        className={styles.donutSvg}
        role="img"
        aria-label="Sales by category"
      >
        <circle cx={80} cy={80} r={radius} fill="none" stroke="#f3f4f6" strokeWidth={stroke} />
        {total > 0 &&
          segments.map((seg, i) => (
            <circle
              key={i}
              cx={80}
              cy={80}
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={stroke}
              strokeDasharray={seg.dashArray}
              strokeDashoffset={seg.dashOffset}
              transform="rotate(-90 80 80)"
            />
          ))}
      </svg>
      <div className={styles.donutCenter}>
        <p className={styles.donutCenterLabel}>{centerLabel}</p>
        <p className={styles.donutCenterValue}>{loading ? "—" : centerValue}</p>
      </div>
    </div>
  );
}

/* ── Icons ── */

function ChevronLeft() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

