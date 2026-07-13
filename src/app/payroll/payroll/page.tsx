"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useAuth } from "@/components/AuthProvider";
import { isOwner } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

// Week picker is only mounted after the owner taps the date pill — keep
// it out of the initial bundle.
const CalendarPicker = dynamic(() => import("@/components/CalendarPicker"), {
  ssr: false,
});

/**
 * Owner Payroll overview — reads from /api/payroll/summary which pulls
 * the selected week's detail (per-employee breakdown + weekly totals)
 * from the Google Pay History sheet plus the two prior weeks, and looks
 * up the matching Sydney-week Gross Sales from Firestore so the
 * "Payroll % of sales" gauge is meaningful.
 */

const SYDNEY_TZ = "Australia/Sydney";

type PayrollTotals = {
  netPay: number;
  tax: number;
  superAnn: number;
  cashPay: number;
  totalIncSuper: number;
};

type EmployeePayRow = {
  name: string;
  netPay: number;
  tax: number;
  superAnn: number;
  cashPay: number;
  totalIncSuper: number;
};

type WeekDetail = {
  weekStartISO: string;
  weekEndISO: string;
  employees: EmployeePayRow[];
  totals: PayrollTotals;
};

type SummaryPayload = {
  weekStart: string;
  weekEnd: string;
  current: WeekDetail;
  previous: WeekDetail;
  twoWeeksAgo: WeekDetail;
  prev2WeekAvg: PayrollTotals;
  sales: { current: number; prev1: number; prev2: number };
  payrollPctSales: number | null;
  payrollPctPrev: number | null;
};

/* ── Date helpers ── */

function sydneyTodayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: SYDNEY_TZ });
}

/** Monday of the week containing `dateKey`. */
function isoMondayOf(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - dow);
  return dt.toISOString().slice(0, 10);
}

function isoLastCompletedPayWeek(): string {
  // Yurica's Pay History sheet finalises a week after Sunday closes. So
  // the most recently *paid* week has its Sunday last Sunday or earlier
  // — i.e. two Mondays ago from today. Landing there means the page
  // opens on real numbers instead of the current in-progress week that
  // hasn't been paid yet.
  const thisMonday = isoMondayOf(sydneyTodayKey());
  const [y, m, d] = thisMonday.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 14);
  return dt.toISOString().slice(0, 10);
}

function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function fmtWeekRange(mondayISO: string): string {
  const sundayISO = addDaysISO(mondayISO, 6);
  const [my, mm, md] = mondayISO.split("-").map(Number);
  const [sy, sm, sd] = sundayISO.split("-").map(Number);
  const mon = new Date(Date.UTC(my, mm - 1, md, 12));
  const sun = new Date(Date.UTC(sy, sm - 1, sd, 12));
  const monPart = `${md} ${mon.toLocaleDateString("en-AU", { month: "short", timeZone: "UTC" })}`;
  const sunPart = sun.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `${monPart} – ${sunPart}`;
}

function fmtCurrency(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function safePct(current: number, baseline: number): number | null {
  if (!Number.isFinite(baseline) || baseline === 0) return null;
  return ((current - baseline) / baseline) * 100;
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* ── Session cache ── */

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
    /* ignore */
  }
}

/* ── Page ── */

export default function PayrollOverviewPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwner(user);

  const [weekMondayISO, setWeekMondayISO] = useState<string>("");
  const [todayKey, setTodayKey] = useState<string>("");
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!allowed) router.replace(ROUTES.home);
  }, [allowed, authLoading, router]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setTodayKey(sydneyTodayKey());
    setWeekMondayISO(isoLastCompletedPayWeek());
  }, []);

  useEffect(() => {
    if (!allowed || !weekMondayISO) return;
    let cancelled = false;
    // Bump the version whenever the API's response shape or values
    // change so stale sessionStorage entries don't shadow the fix.
    const cacheKey = `y.payroll.summary.v2.${weekMondayISO}`;
    const cached = readSession<SummaryPayload>(cacheKey);
    if (cached) {
      setSummary(cached);
    } else {
      setSummary(null);
    }
    setError(null);
    setFetching(true);
    (async () => {
      try {
        const res = await fetch(`/api/payroll/summary?weekStart=${weekMondayISO}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as SummaryPayload;
        if (cancelled) return;
        setSummary(data);
        writeSession(cacheKey, data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load payroll");
      } finally {
        if (!cancelled) setFetching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allowed, weekMondayISO]);

  const chips = useMemo(() => {
    if (!summary) return null;
    const a = summary.current.totals;
    const b = summary.prev2WeekAvg;
    return {
      netPay: safePct(a.netPay, b.netPay),
      tax: safePct(a.tax, b.tax),
      superAnn: safePct(a.superAnn, b.superAnn),
      cashPay: safePct(a.cashPay, b.cashPay),
      totalIncSuper: safePct(a.totalIncSuper, b.totalIncSuper),
    };
  }, [summary]);

  const payrollPctChip = useMemo(() => {
    if (!summary) return null;
    return safePct(summary.payrollPctSales ?? 0, summary.payrollPctPrev ?? 0);
  }, [summary]);

  const topPaid = useMemo(() => {
    if (!summary) return [];
    return [...summary.current.employees]
      .sort((a, b) => b.totalIncSuper - a.totalIncSuper)
      .slice(0, 5);
  }, [summary]);

  if (authLoading || !allowed) return <Splash />;

  const totals = summary?.current.totals;
  const prevTotals = summary?.previous.totals;
  const previousLabel = summary ? fmtWeekRange(summary.previous.weekStartISO) : "—";

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
          <h1 className={styles.pageTitle}>Payroll</h1>
          <p className={styles.pageSubtitle}>Weekly payroll overview and summary.</p>
        </div>
        <button
          type="button"
          className={styles.datePill}
          onClick={() => setCalendarOpen(true)}
          aria-label="Pick a pay week"
        >
          <CalendarIcon />
          <span className={styles.datePillLabel}>
            {weekMondayISO ? fmtWeekRange(weekMondayISO) : "—"}
          </span>
          <span className={styles.datePillChevron} aria-hidden="true">▾</span>
        </button>
      </header>

      {calendarOpen && (
        <CalendarPicker
          value={weekMondayISO}
          maxDate={todayKey}
          singleOnly
          onChange={(pickedISO) => {
            // Snap whichever day the owner picked to that week's Monday
            // so the summary always fetches a full Mon–Sun window.
            setWeekMondayISO(isoMondayOf(pickedISO));
            setCalendarOpen(false);
          }}
          onRangeChange={() => {
            /* range mode disabled via singleOnly */
          }}
          onClose={() => setCalendarOpen(false)}
        />
      )}

      {/* ── Payroll % of sales ── */}
      <section className={styles.pctCard}>
        <div>
          <p className={styles.pctLabel}>
            PAYROLL % OF SALES <InfoIcon />
          </p>
          <p className={styles.pctBig}>
            {summary?.payrollPctSales !== null && summary?.payrollPctSales !== undefined
              ? summary.payrollPctSales.toFixed(1)
              : "—"}
            <span className={styles.pctBigUnit}>%</span>
          </p>
          {payrollPctChip !== null && (
            <span className={styles.pctChip}>
              {payrollPctChip >= 0 ? "↑" : "↓"} {Math.abs(payrollPctChip).toFixed(1)}%{" "}
              <span className={styles.pctChipSub}>vs prev 2 weeks</span>
            </span>
          )}
        </div>
        <GaugeChart pct={summary?.payrollPctSales ?? null} />
      </section>

      {error && <p className={styles.errorMsg}>{error}</p>}

      {/* ── Payroll summary ── */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <p className={styles.cardTitle}>
            PAYROLL SUMMARY <span className={styles.cardTitleSub}>(Last Week)</span>
          </p>
          <p className={styles.cardTitleRange}>
            {summary ? fmtWeekRange(summary.current.weekStartISO) : ""}
          </p>
        </div>

        <div className={styles.summaryGrid}>
          <SummaryTile
            icon={<WalletIcon />}
            label="Net Pay"
            value={totals ? fmtCurrency(totals.netPay) : "—"}
            deltaPct={chips?.netPay ?? null}
            loading={fetching && !summary}
          />
          <SummaryTile
            icon={<TaxIcon />}
            label="Tax"
            value={totals ? fmtCurrency(totals.tax) : "—"}
            deltaPct={chips?.tax ?? null}
            loading={fetching && !summary}
          />
          <SummaryTile
            icon={<PersonBadgeIcon />}
            label="Superannuation"
            value={totals ? fmtCurrency(totals.superAnn) : "—"}
            deltaPct={chips?.superAnn ?? null}
            loading={fetching && !summary}
          />
          <SummaryTile
            icon={<CashIcon />}
            label="Cash Pay"
            value={totals ? fmtCurrency(totals.cashPay) : "—"}
            deltaPct={chips?.cashPay ?? null}
            loading={fetching && !summary}
          />
        </div>

        <div className={styles.totalRow}>
          <span className={styles.totalIcon} aria-hidden="true"><WalletIcon /></span>
          <span className={styles.totalLabel}>Total Payroll Cost</span>
          <span className={styles.totalValue}>
            {totals ? fmtCurrency(totals.totalIncSuper) : "—"}
          </span>
          {chips?.totalIncSuper !== null && chips?.totalIncSuper !== undefined && (
            <span className={styles.totalDeltaWrap}>
              <span
                className={
                  chips.totalIncSuper >= 0 ? styles.totalDeltaUp : styles.totalDeltaDown
                }
              >
                {chips.totalIncSuper >= 0 ? "↑" : "↓"}{" "}
                {Math.abs(chips.totalIncSuper).toFixed(1)}%
              </span>
              <span className={styles.totalDeltaSub}>vs prev 2 weeks avg</span>
            </span>
          )}
        </div>
      </section>

      {/* ── Weekly comparison ── */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <p className={styles.cardTitle}>WEEKLY COMPARISON</p>
          <div className={styles.legendRow}>
            <span className={styles.legendItem}>
              <span className={`${styles.legendDot} ${styles.legendDotWarm}`} /> Recent Week
            </span>
            <span className={styles.legendItem}>
              <span className={`${styles.legendDot} ${styles.legendDotMuted}`} /> 2 Weeks Ago
            </span>
          </div>
        </div>
        <div className={styles.comparisonGrid}>
          <ComparisonColumn
            label={summary ? fmtWeekRange(summary.current.weekStartISO) : "—"}
            totals={totals ?? null}
            highlight
          />
          <ComparisonColumn label={previousLabel} totals={prevTotals ?? null} />
        </div>
      </section>

      {/* ── Top paid employees ── */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <p className={styles.cardTitle}>
            TOP PAID EMPLOYEES <span className={styles.cardTitleSub}>(last week)</span>
          </p>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thLeft}>Employee</th>
                <th className={styles.thRight}>Net Pay</th>
                <th className={styles.thRight}>Superannuation</th>
                <th className={styles.thRight}>Cash Pay</th>
              </tr>
            </thead>
            <tbody>
              {topPaid.length === 0 ? (
                <tr>
                  <td colSpan={4} className={styles.tableEmpty}>
                    {fetching ? "Loading…" : "No pay records for this week yet."}
                  </td>
                </tr>
              ) : (
                topPaid.map((emp) => (
                  <tr key={emp.name}>
                    <td>
                      <span className={styles.empRow}>
                        <span className={styles.empAvatar}>{initials(emp.name)}</span>
                        <span className={styles.empName}>{emp.name}</span>
                      </span>
                    </td>
                    <td className={styles.tdRight}>{fmtCurrency(emp.netPay)}</td>
                    <td className={styles.tdRight}>{fmtCurrency(emp.superAnn)}</td>
                    <td className={styles.tdRight}>{fmtCurrency(emp.cashPay)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/* ── Sub-components ── */

function SummaryTile({
  icon,
  label,
  value,
  deltaPct,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  deltaPct: number | null;
  loading: boolean;
}) {
  return (
    <div className={styles.tile}>
      <span className={styles.tileIcon} aria-hidden="true">{icon}</span>
      <p className={styles.tileLabel}>{label}</p>
      <p className={styles.tileValue}>{loading ? "…" : value}</p>
      {deltaPct !== null ? (
        <p
          className={
            deltaPct >= 0 ? styles.tileDeltaUp : styles.tileDeltaDown
          }
        >
          {deltaPct >= 0 ? "↑" : "↓"} {Math.abs(deltaPct).toFixed(1)}%
        </p>
      ) : (
        <p className={styles.tileDeltaMuted}>—</p>
      )}
      <p className={styles.tileDeltaSub}>vs prev 2 weeks avg</p>
    </div>
  );
}

function ComparisonColumn({
  label,
  totals,
  highlight = false,
}: {
  label: string;
  totals: PayrollTotals | null;
  highlight?: boolean;
}) {
  return (
    <div className={styles.comparisonCol}>
      <p className={highlight ? styles.comparisonLabelHot : styles.comparisonLabel}>{label}</p>
      <ComparisonRow name="Net Pay" value={totals?.netPay} highlight={highlight} />
      <ComparisonRow name="Tax" value={totals?.tax} highlight={highlight} />
      <ComparisonRow name="Superannuation" value={totals?.superAnn} highlight={highlight} />
      <ComparisonRow name="Cash Pay" value={totals?.cashPay} highlight={highlight} />
      <div className={styles.comparisonDivider} />
      <ComparisonRow
        name="Total Payroll Cost"
        value={totals?.totalIncSuper}
        highlight={highlight}
        bold
      />
    </div>
  );
}

function ComparisonRow({
  name,
  value,
  highlight,
  bold = false,
}: {
  name: string;
  value: number | undefined;
  highlight?: boolean;
  bold?: boolean;
}) {
  return (
    <div className={styles.comparisonRow}>
      <span className={bold ? styles.comparisonNameBold : styles.comparisonName}>{name}</span>
      <span
        className={
          bold
            ? highlight
              ? styles.comparisonValueBoldHot
              : styles.comparisonValueBold
            : highlight
              ? styles.comparisonValueHot
              : styles.comparisonValue
        }
      >
        {typeof value === "number" ? fmtCurrency(value) : "—"}
      </span>
    </div>
  );
}

function GaugeChart({ pct }: { pct: number | null }) {
  const radius = 44;
  const stroke = 10;
  const circumference = 2 * Math.PI * radius;
  const capped = pct === null ? 0 : Math.max(0, Math.min(pct, 100));
  const fillLen = (capped / 100) * circumference;
  return (
    <div className={styles.gauge}>
      <svg viewBox="0 0 120 120" className={styles.gaugeSvg} aria-hidden="true">
        <circle cx={60} cy={60} r={radius} fill="none" stroke="#fce6d3" strokeWidth={stroke} />
        {pct !== null && (
          <circle
            cx={60}
            cy={60}
            r={radius}
            fill="none"
            stroke="#FF6A13"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${fillLen} ${circumference - fillLen}`}
            transform="rotate(-90 60 60)"
          />
        )}
      </svg>
      <div className={styles.gaugeCenter}>
        <p className={styles.gaugeValue}>
          {pct !== null ? pct.toFixed(1) : "—"}
          <span className={styles.gaugeUnit}>%</span>
        </p>
        <p className={styles.gaugeSub}>of Sales</p>
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

function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: -2 }}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 7h18a1 1 0 0 1 1 1v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z" />
      <path d="M2 7V6a2 2 0 0 1 2-2h13" />
      <circle cx="17" cy="13" r="1.6" />
    </svg>
  );
}

function TaxIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <text x="12" y="16" textAnchor="middle" fontSize="8" fontWeight="800" fill="currentColor" stroke="none">TAX</text>
    </svg>
  );
}

function PersonBadgeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="9" r="3.5" />
      <path d="M5 20c1.5-3.5 4-5 7-5s5.5 1.5 7 5" />
      <path d="M15 9a3.5 3.5 0 0 0-3.5-3.5" />
      <path d="M15 12l1 1 2-2" />
    </svg>
  );
}

function CashIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <line x1="5" y1="10" x2="5" y2="14" />
      <line x1="19" y1="10" x2="19" y2="14" />
    </svg>
  );
}

