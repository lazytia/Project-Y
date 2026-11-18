"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useAuth } from "@/components/AuthProvider";
import { useBackToDashboard } from "@/hooks/useBackToDashboard";
import { isChef, isOwner } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import { COMBINED_TARGET_PCT } from "@/lib/cost-targets";
import { isoLastCompletedPayWeek, sydneyTodayKey } from "@/lib/owner-money-prefetch";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

const CalendarPicker = dynamic(() => import("@/components/CalendarPicker"), {
  ssr: false,
});

/**
 * Weekly Cost Control — what the kitchen cost in a week, as a share of that
 * week's sales: payroll, supplier spend, the two together against the house
 * target, and the last four weeks side by side.
 *
 * Built from the same two summaries Payroll Cost and Supplier Cost read
 * (/api/payroll/summary, /api/money/purchasing-cost/summary), so a figure
 * here is always the figure on the page it links to. Each returns the week
 * asked for and the one before it, so two calls each cover four weeks.
 */

/** How many weeks the trend shows, ending with the selected one. */
const TREND_WEEKS = 4;

type PayrollSummary = {
  current: { weekStartISO: string; totals: { totalIncSuper: number } };
  previous: { weekStartISO: string; totals: { totalIncSuper: number } };
  sales: { current: number; prev1: number };
};

type SupplierSummary = {
  current: { weekStart: string; total: number };
  previous: { weekStart: string; total: number };
  sales: { current: number; previous: number };
};

type WeekCost = {
  weekStart: string;
  sales: number;
  payroll: number;
  supplier: number;
};

/* ── Date helpers ── */

function isoMondayOf(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - dow);
  return dt.toISOString().slice(0, 10);
}

function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function fmtDay(iso: string, withYear = false): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

function fmtWeekRange(mondayISO: string): string {
  return `${fmtDay(mondayISO)} – ${fmtDay(addDaysISO(mondayISO, 6), true)}`;
}

function fmtCurrency(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pctOf(cost: number, sales: number): number | null {
  return sales > 0 && cost > 0 ? (cost / sales) * 100 : null;
}

/* ── Data ── */

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** The four weeks ending with `weekStart`, oldest first. */
async function loadWeeks(weekStart: string): Promise<WeekCost[]> {
  const older = addDaysISO(weekStart, -14);
  const [payNow, payOld, supNow, supOld] = await Promise.all([
    getJson<PayrollSummary>(`/api/payroll/summary?weekStart=${weekStart}`),
    getJson<PayrollSummary>(`/api/payroll/summary?weekStart=${older}`),
    getJson<SupplierSummary>(`/api/money/purchasing-cost/summary?weekStart=${weekStart}`),
    getJson<SupplierSummary>(`/api/money/purchasing-cost/summary?weekStart=${older}`),
  ]);
  const week = (
    start: string,
    pay: PayrollSummary,
    sup: SupplierSummary,
    which: "current" | "previous",
  ): WeekCost => ({
    weekStart: start,
    sales: which === "current" ? pay.sales.current : pay.sales.prev1,
    payroll: pay[which].totals.totalIncSuper,
    supplier: sup[which].total,
  });
  return [
    week(addDaysISO(older, -7), payOld, supOld, "previous"),
    week(older, payOld, supOld, "current"),
    week(addDaysISO(weekStart, -7), payNow, supNow, "previous"),
    week(weekStart, payNow, supNow, "current"),
  ];
}

/* ── Session cache ── */

const SESSION_TTL_MS = 5 * 60 * 1000;

function readSession<T>(key: string): T | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; data: T };
    return Date.now() - parsed.at > SESSION_TTL_MS ? null : parsed.data;
  } catch {
    return null;
  }
}

function writeSession<T>(key: string, data: T) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* ignore */
  }
}

/* ── Page ── */

export default function WeeklyCostControlPage() {
  const router = useRouter();
  const goBack = useBackToDashboard();
  const { user, loading: authLoading } = useAuth();
  // Owners and the head chef; the chef's menu simply has no Sales Overview.
  const allowed = isOwner(user) || isChef(user);

  const [weekMondayISO, setWeekMondayISO] = useState(isoLastCompletedPayWeek);
  const [todayKey] = useState(sydneyTodayKey);
  const [weeks, setWeeks] = useState<WeekCost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);

  useEffect(() => {
    if (authLoading || !user) return;
    if (!allowed) router.replace(ROUTES.home);
  }, [allowed, authLoading, user, router]);

  useEffect(() => {
    if (!allowed || !weekMondayISO) return;
    let cancelled = false;
    const cacheKey = `y.weeklycost.v1.${weekMondayISO}`;
    setWeeks(readSession<WeekCost[]>(cacheKey));
    setError(null);
    loadWeeks(weekMondayISO)
      .then((data) => {
        if (cancelled) return;
        setWeeks(data);
        writeSession(cacheKey, data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load costs");
      });
    return () => {
      cancelled = true;
    };
  }, [allowed, weekMondayISO]);

  const view = useMemo(() => {
    if (!weeks) return null;
    const cur = weeks[TREND_WEEKS - 1];
    const prev = weeks[TREND_WEEKS - 2];
    const payrollPct = pctOf(cur.payroll, cur.sales);
    const supplierPct = pctOf(cur.supplier, cur.sales);
    const payrollPrev = pctOf(prev.payroll, prev.sales);
    const supplierPrev = pctOf(prev.supplier, prev.sales);
    const combined =
      payrollPct !== null || supplierPct !== null ? (payrollPct ?? 0) + (supplierPct ?? 0) : null;
    return {
      cur,
      payrollPct,
      supplierPct,
      payrollPp: payrollPct !== null && payrollPrev !== null ? payrollPct - payrollPrev : null,
      supplierPp: supplierPct !== null && supplierPrev !== null ? supplierPct - supplierPrev : null,
      combined,
    };
  }, [weeks]);

  if (authLoading || !user || !allowed) return <Splash />;

  const overBy = view?.combined != null ? view.combined - COMBINED_TARGET_PCT : null;

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <button type="button" className={styles.backBtn} onClick={goBack} aria-label="Back">
          <ChevronLeft />
        </button>
        <div className={styles.headerTitles}>
          <h1 className={styles.pageTitle}>Weekly Cost Control</h1>
          <p className={styles.pageSubtitle}>Kitchen cost overview for better cost management.</p>
        </div>
      </header>

      <button
        type="button"
        className={styles.datePill}
        onClick={() => setCalendarOpen(true)}
        aria-label="Pick a week"
      >
        <CalendarIcon />
        <span className={styles.datePillLabel}>{fmtWeekRange(weekMondayISO)}</span>
        <span className={styles.datePillChevron} aria-hidden="true">▾</span>
      </button>

      {calendarOpen && (
        <CalendarPicker
          value={weekMondayISO}
          maxDate={todayKey}
          singleOnly
          onChange={(pickedISO) => {
            setWeekMondayISO(isoMondayOf(pickedISO));
            setCalendarOpen(false);
          }}
          onRangeChange={() => {}}
          onClose={() => setCalendarOpen(false)}
        />
      )}

      <section className={styles.salesCard}>
        <span className={styles.salesIcon} aria-hidden="true"><BarsIcon /></span>
        <div>
          <p className={styles.salesLabel}>Weekly Sales</p>
          <p className={styles.salesValue}>{view ? fmtCurrency(view.cur.sales) : "—"}</p>
        </div>
      </section>

      <div className={styles.costGrid}>
        <CostCard
          href="/payroll/payroll"
          icon={<PeopleIcon />}
          label="Payroll Cost"
          amount={view?.cur.payroll ?? null}
          pct={view?.payrollPct ?? null}
          pp={view?.payrollPp ?? null}
        />
        <CostCard
          href="/money/purchasing-cost"
          icon={<BoxIcon />}
          label="Supplier Cost"
          amount={view?.cur.supplier ?? null}
          pct={view?.supplierPct ?? null}
          pp={view?.supplierPp ?? null}
        />
      </div>

      {error && <p className={styles.errorMsg}>{error}</p>}

      {view?.combined != null && overBy !== null && (
        <section className={overBy > 0 ? styles.combinedAlert : styles.combinedOk}>
          <span className={styles.combinedIcon} aria-hidden="true">
            {overBy > 0 ? <AlertIcon /> : <CheckIcon />}
          </span>
          <div>
            <p className={styles.combinedTitle}>Combined Cost: {view.combined.toFixed(1)}%</p>
            <p className={styles.combinedSub}>
              Target ≤ {COMBINED_TARGET_PCT.toFixed(1)}%
              <span className={styles.combinedSep} aria-hidden="true">|</span>
              {overBy > 0
                ? `Above target by ${overBy.toFixed(1)} pp`
                : `Within target by ${Math.abs(overBy).toFixed(1)} pp`}
            </p>
          </div>
        </section>
      )}

      <section className={styles.trendCard}>
        <div className={styles.trendHead}>
          <p className={styles.trendTitle}>
            Cost Trend <span className={styles.trendTitleSub}>(% of Sales)</span>
          </p>
          <div className={styles.legend}>
            <span className={styles.legendItem}>
              <span className={`${styles.legendDot} ${styles.legendPayroll}`} /> Payroll
            </span>
            <span className={styles.legendItem}>
              <span className={`${styles.legendDot} ${styles.legendSupplier}`} /> Supplier
            </span>
          </div>
        </div>
        <TrendBars weeks={weeks} selected={weekMondayISO} />
      </section>
    </div>
  );
}

/* ── Sub-components ── */

/** One cost, its share of sales, and how that share moved since last week. */
function CostCard({
  href,
  icon,
  label,
  amount,
  pct,
  pp,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  amount: number | null;
  pct: number | null;
  pp: number | null;
}) {
  return (
    <Link href={href} className={styles.costCard}>
      <p className={styles.costLabel}>
        <span className={styles.costIcon} aria-hidden="true">{icon}</span>
        {label}
      </p>
      <div className={styles.costMain}>
        <div className={styles.costText}>
          <p className={styles.costValue}>{amount !== null ? fmtCurrency(amount) : "—"}</p>
          <p className={styles.costPct}>{pct !== null ? `${pct.toFixed(1)}% of sales` : "— of sales"}</p>
        </div>
        <span className={styles.costChev} aria-hidden="true">›</span>
      </div>
      <div className={styles.costFoot}>
        {pp !== null ? (
          <p className={pp >= 0 ? styles.deltaUp : styles.deltaDown}>
            {pp >= 0 ? "↑" : "↓"} {Math.abs(pp).toFixed(1)} pp
          </p>
        ) : (
          <p className={styles.deltaMuted}>—</p>
        )}
        <p className={styles.deltaSub}>vs previous week</p>
      </div>
    </Link>
  );
}

/**
 * Four stacked bars: payroll at the bottom, supplier on top, the total above.
 * Heights share one scale so the weeks compare by eye.
 */
function TrendBars({ weeks, selected }: { weeks: WeekCost[] | null; selected: string }) {
  const rows = (weeks ?? []).map((w) => {
    const payroll = pctOf(w.payroll, w.sales) ?? 0;
    const supplier = pctOf(w.supplier, w.sales) ?? 0;
    return { weekStart: w.weekStart, payroll, supplier, total: payroll + supplier };
  });
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <div className={styles.bars}>
      {rows.length === 0
        ? Array.from({ length: TREND_WEEKS }, (_, i) => (
            <div key={i} className={styles.barCol}>
              <div className={styles.barArea} />
              <p className={styles.barWeek}>—</p>
            </div>
          ))
        : rows.map((r) => (
            <div key={r.weekStart} className={styles.barCol}>
              <div className={styles.barArea}>
                <p className={styles.barTotal}>{r.total > 0 ? `${r.total.toFixed(1)}%` : "—"}</p>
                {r.supplier > 0 && (
                  <div
                    className={styles.barSupplier}
                    style={{ height: `calc((100% - var(--space-6)) * ${(r.supplier / max).toFixed(4)})` }}
                  >
                    {r.supplier.toFixed(1)}%
                  </div>
                )}
                {r.payroll > 0 && (
                  <div
                    className={styles.barPayroll}
                    style={{ height: `calc((100% - var(--space-6)) * ${(r.payroll / max).toFixed(4)})` }}
                  >
                    {r.payroll.toFixed(1)}%
                  </div>
                )}
              </div>
              <p className={r.weekStart === selected ? styles.barWeekOn : styles.barWeek}>
                {fmtDay(r.weekStart)}
              </p>
            </div>
          ))}
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
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function BarsIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="3" y="13" width="4.5" height="8" rx="1" />
      <rect x="9.75" y="9" width="4.5" height="12" rx="1" />
      <rect x="16.5" y="4" width="4.5" height="17" rx="1" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.6-3.8 3.2-6 6.5-6s5.9 2.2 6.5 6Z" />
      <circle cx="17" cy="9" r="2.6" />
      <path d="M16.6 14.2c2.6.2 4.4 2.2 4.9 5.8h-4.3c-.3-2.3-1.2-4.3-2.7-5.6.7-.1 1.4-.2 2.1-.2Z" />
    </svg>
  );
}

function BoxIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2.8 20.5 7.5v9L12 21.2 3.5 16.5v-9Z" />
      <path d="M3.5 7.5 12 12.2l8.5-4.7" />
      <line x1="12" y1="12.2" x2="12" y2="21.2" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="7" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polyline points="8 12.5 11 15.5 16.5 9.5" />
    </svg>
  );
}
