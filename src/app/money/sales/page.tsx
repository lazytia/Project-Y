"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { collection, getDocs, query, where } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { isOwner } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

// Full-screen calendar overlay — code-split so the initial Sales bundle
// doesn't include it until the owner taps the date pill.
const CalendarPicker = dynamic(() => import("@/components/CalendarPicker"), {
  ssr: false,
});

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

/* ── Session cache helpers — save the network hop when the owner
 *  bounces off Sales and back within the same tab. TTL is short (5 min)
 *  so the numbers stay fresh but tab-switches feel instant. */
const SESSION_TTL_MS = 5 * 60 * 1000;

function readSession<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; data: T };
    if (Date.now() - parsed.at > SESSION_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeSession<T>(key: string, data: T) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* quota / private mode — ignore */
  }
}

/* ── Page ── */

export default function SalesPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwner(user);

  const [todayKey, setTodayKey] = useState<string>("");
  // Monday of the currently-viewed week.
  const [weekMondayISO, setWeekMondayISO] = useState<string>("");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [daily, setDaily] = useState<DailyMap | null>(null);
  const [categories, setCategories] = useState<CategoryRow[] | null>(null);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  // sales_daily is only backfilled for recent months so the older months
  // of the current year read as zero. Hit Square directly for both
  // year buckets so the comparison is apples-to-apples.
  const [thisYearMonthly, setThisYearMonthly] = useState<number[] | null>(null);
  const [lastYearMonthly, setLastYearMonthly] = useState<number[] | null>(null);
  // Fresh-from-Square weekly bars for the selected week, keyed by the
  // week's Monday ISO. Populated by /api/square/weekly-daily; falls back
  // to the Firestore sales_daily buckets while the API is in flight.
  const [thisWeekDaily, setThisWeekDaily] = useState<number[] | null>(null);
  const [lastWeekDaily, setLastWeekDaily] = useState<number[] | null>(null);

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

  // ── Firestore daily fetch — 3 years back covers the weekly bars for
  //    anything the calendar picker will let the owner pick, and the
  //    yearly bars for last year's monthly buckets.
  useEffect(() => {
    if (!allowed || !todayKey) return;
    let cancelled = false;
    (async () => {
      try {
        // sales_daily documents are keyed by "YYYY-MM-DD" but the schema
        // also has a dateISO field, so filter on that for a clean range.
        const [ty] = todayKey.split("-").map(Number);
        const startISO = `${ty - 2}-01-01`;
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

  // ── Weekly daily bars (this + last week) — always Square-direct so
  //    the "This Week vs Last Week" chart reflects the live dashboard
  //    figure rather than whatever nightly cache last touched
  //    sales_daily. Cached per week in sessionStorage.
  useEffect(() => {
    if (!allowed || !weekMondayISO) return;
    let cancelled = false;
    const cacheKey = `y.sales.weekDaily.${weekMondayISO}`;
    type WeeklyCache = { thisWeek: number[]; lastWeek: number[] };
    const cached = readSession<WeeklyCache>(cacheKey);
    if (cached) {
      setThisWeekDaily(cached.thisWeek);
      setLastWeekDaily(cached.lastWeek);
    } else {
      setThisWeekDaily(null);
      setLastWeekDaily(null);
    }
    (async () => {
      try {
        if (cached) return; // sessionStorage was still fresh
        const res = await fetch(`/api/square/weekly-daily?weekStart=${weekMondayISO}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          thisWeek: { daily: number[] };
          lastWeek: { daily: number[] };
        };
        if (cancelled) return;
        setThisWeekDaily(data.thisWeek.daily);
        setLastWeekDaily(data.lastWeek.daily);
        writeSession<WeeklyCache>(cacheKey, {
          thisWeek: data.thisWeek.daily,
          lastWeek: data.lastWeek.daily,
        });
      } catch (err) {
        console.error("[sales] weekly-daily fetch failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allowed, weekMondayISO]);

  // ── Yearly monthly totals (this + last year, both from Square).
  //    sales_daily doesn't have a full backfill so we always hit the API
  //    for the yearly chart. Both years fire in parallel — with a
  //    sessionStorage cache so tab-back-and-forth is instant.
  useEffect(() => {
    if (!allowed || !todayKey) return;
    let cancelled = false;
    const thisYear = Number(todayKey.slice(0, 4));
    const lastYear = thisYear - 1;
    const thisKey = `y.sales.yearly.${thisYear}`;
    const lastKey = `y.sales.yearly.${lastYear}`;

    // Hydrate from session first so the chart paints before the network
    // round-trip returns.
    const cachedThis = readSession<number[]>(thisKey);
    const cachedLast = readSession<number[]>(lastKey);
    if (cachedThis) setThisYearMonthly(cachedThis);
    if (cachedLast) setLastYearMonthly(cachedLast);

    (async () => {
      try {
        const [thisRes, lastRes] = await Promise.all([
          cachedThis
            ? Promise.resolve<Response | null>(null)
            : fetch(`/api/square/yearly-sales?year=${thisYear}`),
          cachedLast
            ? Promise.resolve<Response | null>(null)
            : fetch(`/api/square/yearly-sales?year=${lastYear}`),
        ]);
        const thisData = thisRes && thisRes.ok ? await thisRes.json() : null;
        const lastData = lastRes && lastRes.ok ? await lastRes.json() : null;
        if (cancelled) return;
        if (thisData?.monthly) {
          setThisYearMonthly(thisData.monthly as number[]);
          writeSession(thisKey, thisData.monthly);
        } else if (!cachedThis) {
          setThisYearMonthly(new Array(12).fill(0));
        }
        if (lastData?.monthly) {
          setLastYearMonthly(lastData.monthly as number[]);
          writeSession(lastKey, lastData.monthly);
        } else if (!cachedLast) {
          setLastYearMonthly(new Array(12).fill(0));
        }
      } catch (err) {
        console.error("[sales] yearly fetch failed:", err);
        if (!cancelled) {
          if (!cachedThis) setThisYearMonthly(new Array(12).fill(0));
          if (!cachedLast) setLastYearMonthly(new Array(12).fill(0));
        }
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

  /* ── Derived: weekly bars ──
   *   Prefer the Square-direct API response (thisWeekDaily / lastWeekDaily)
   *   when available. Falls back to the Firestore sales_daily bucket while
   *   the API round-trip is still in flight so the chart doesn't flash
   *   empty on cold loads. */
  const weekly = useMemo(() => {
    if (!weekMondayISO) return null;
    const prevMonday = addDaysISO(weekMondayISO, -7);
    let thisWeek: number[];
    let lastWeek: number[];
    if (thisWeekDaily && lastWeekDaily) {
      thisWeek = thisWeekDaily;
      lastWeek = lastWeekDaily;
    } else if (daily) {
      thisWeek = [];
      lastWeek = [];
      for (let i = 0; i < 7; i++) {
        thisWeek.push(daily.get(addDaysISO(weekMondayISO, i)) ?? 0);
        lastWeek.push(daily.get(addDaysISO(prevMonday, i)) ?? 0);
      }
    } else {
      return null;
    }
    const thisTotal = thisWeek.reduce((s, v) => s + v, 0);
    const lastTotal = lastWeek.reduce((s, v) => s + v, 0);
    const deltaPct = lastTotal > 0 ? ((thisTotal - lastTotal) / lastTotal) * 100 : null;
    return { thisWeek, lastWeek, thisTotal, lastTotal, deltaPct };
  }, [daily, weekMondayISO, thisWeekDaily, lastWeekDaily]);

  /* ── Derived: yearly monthly bars ──
   *   Both years read from the /yearly-sales API. sales_daily is used
   *   as a cheap fallback while the API round-trip is still in flight
   *   so the chart animates in progressively instead of flashing empty. */
  const yearly = useMemo(() => {
    if (!todayKey) return null;
    const [ty] = todayKey.split("-").map(Number);
    const thisFromDaily = new Array(12).fill(0);
    const lastFromDaily = new Array(12).fill(0);
    if (daily) {
      for (const [iso, val] of daily) {
        const [yy, mm] = iso.split("-").map(Number);
        if (yy === ty) thisFromDaily[mm - 1] += val;
        else if (yy === ty - 1) lastFromDaily[mm - 1] += val;
      }
    }
    const thisYear = thisYearMonthly ?? thisFromDaily;
    const lastYear = lastYearMonthly ?? lastFromDaily;
    const thisYtd = thisYear.reduce((s, v) => s + v, 0);
    const lastYtd = lastYear.reduce((s, v) => s + v, 0);
    const deltaPct = lastYtd > 0 ? ((thisYtd - lastYtd) / lastYtd) * 100 : null;
    return { thisYear, lastYear, thisYtd, lastYtd, deltaPct };
  }, [daily, todayKey, thisYearMonthly, lastYearMonthly]);

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
        <button
          type="button"
          className={styles.datePill}
          onClick={() => setCalendarOpen(true)}
          aria-label="Choose week"
        >
          <CalendarIcon />
          <span className={styles.datePillLabel}>
            {weekMondayISO ? fmtRangeLabel(weekMondayISO) : "—"}
          </span>
          <span className={styles.datePillChevron} aria-hidden="true">▾</span>
        </button>
      </header>

      {calendarOpen && weekMondayISO && (
        <CalendarPicker
          value={weekMondayISO}
          maxDate={todayKey}
          singleOnly
          onChange={(d) => {
            // Snap whatever day the owner picks to the Monday of that
            // week — Sales is always presented in Mon-Sun buckets.
            setWeekMondayISO(isoMondayOf(d));
          }}
          onRangeChange={() => {
            /* range mode disabled */
          }}
          onClose={() => setCalendarOpen(false)}
        />
      )}

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
            {(categories ?? []).slice(0, 5).map((c, idx) => (
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

  // Precompute the arc-center angle for each slice so we can drop a "% "
  // label right on top of the ring. Only slices with a wide-enough sweep
  // (≥ 5%) get a label — narrower ones would just overlap their neighbours.
  const segments = slices.map((v, i) => {
    const fraction = total > 0 ? v / total : 0;
    const length = fraction * circumference;
    // Angle at the middle of this slice, measured from 12 o'clock (‑Y axis)
    // going clockwise; matches the `rotate(-90 80 80)` we apply below.
    const midAngleRad = ((offset + length / 2) / circumference) * 2 * Math.PI - Math.PI / 2;
    const labelX = 80 + Math.cos(midAngleRad) * radius;
    const labelY = 80 + Math.sin(midAngleRad) * radius;
    const seg = {
      color: donutColorAt(i),
      dashArray: `${length} ${circumference - length}`,
      dashOffset: -offset,
      fraction,
      labelX,
      labelY,
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
        {total > 0 &&
          segments.map(
            (seg, i) =>
              seg.fraction >= 0.05 && (
                <text
                  key={`lbl-${i}`}
                  x={seg.labelX}
                  y={seg.labelY}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className={styles.donutSliceLabel}
                >
                  {Math.round(seg.fraction * 100)}%
                </text>
              ),
          )}
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

