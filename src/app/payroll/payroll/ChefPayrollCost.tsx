"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useAuth } from "@/components/AuthProvider";
import { useBackTo } from "@/hooks/useBackTo";
import { isChef, isOwner } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import { PAYROLL_TARGET_PCT } from "@/lib/cost-targets";
import {
  isoLastCompletedPayWeek,
  sydneyTodayKey,
} from "@/lib/owner-money-prefetch";
import Splash from "@/components/Splash";
import styles from "./ChefPayrollCost.module.css";

// Week picker is only mounted after the owner taps the date pill — keep
// it out of the initial bundle.
const CalendarPicker = dynamic(() => import("@/components/CalendarPicker"), {
  ssr: false,
});

/**
 * Payroll Cost as the head chef sees it — owners get the full overview in
 * OwnerPayroll, and page.tsx picks. One week's payroll and what share of that
 * week's sales it took, against the house target. Reads /api/payroll/summary,
 * which pulls the week and the one before it from the Google Pay History sheet
 * and the matching Sydney-week Gross Sales.
 *
 * Kept to those few figures on purpose: the chef manages whether labour is
 * where it should be this week, not who was paid what.
 *
 * The week shown defaults to the last finished pay week and follows the
 * Sydney date until a week is picked from the calendar.
 */

type PayrollTotals = {
  netPay: number;
  tax: number;
  superAnn: number;
  cashPay: number;
  totalIncSuper: number;
};

type WeekDetail = {
  weekStartISO: string;
  weekEndISO: string;
  totals: PayrollTotals;
};

type SummaryPayload = {
  weekStart: string;
  weekEnd: string;
  current: WeekDetail;
  previous: WeekDetail;
  sales: { current: number; prev1: number };
  payrollPctSales: number | null;
  payrollPctPrev: number | null;
};

/* ── Date helpers ── */

/** Monday of the week containing `dateKey`. */
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

function fmtWeekRange(mondayISO: string): string {
  const sundayISO = addDaysISO(mondayISO, 6);
  const [my, mm, md] = mondayISO.split("-").map(Number);
  const [sy, sm, sd] = sundayISO.split("-").map(Number);
  const mon = new Date(Date.UTC(my, mm - 1, md, 12));
  const sun = new Date(Date.UTC(sy, sm - 1, sd, 12));
  // en-GB, not en-AU: both are day-first, but en-AU spells out "June"/"July"
  // for `month: "short"`.
  const monPart = `${md} ${mon.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}`;
  const sunPart = sun.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `${monPart} – ${sunPart}`;
}

function fmtCurrency(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function safePct(current: number, baseline: number): number | null {
  if (!Number.isFinite(baseline) || baseline === 0) return null;
  return ((current - baseline) / baseline) * 100;
}

/* ── Session cache ── */

const SESSION_TTL_MS = 5 * 60 * 1000;

/** How often an open page re-checks the Sydney date. */
const DATE_ROLL_POLL_MS = 60 * 1000;

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

export default function ChefPayrollCost() {
  const router = useRouter();
  const goBack = useBackTo(ROUTES.weeklyCostControl);
  const { user, loading: authLoading } = useAuth();
  // page.tsx only sends a non-owner here; of those, only the head chef may stay.
  const allowed = isOwner(user) || isChef(user);

  const [weekMondayISO, setWeekMondayISO] = useState(isoLastCompletedPayWeek);
  const [todayKey, setTodayKey] = useState(sydneyTodayKey);
  /** Set once a week is picked from the calendar; from then on the page
   *  stops following the date. */
  const [weekPinned, setWeekPinned] = useState(false);
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) return;
    if (!allowed) router.replace(ROUTES.home);
  }, [allowed, authLoading, user, router]);

  // Installed as a PWA the page is not reloaded between openings, so re-derive
  // today (and the default week) when it comes back to the front, and on a
  // slow timer for a screen left open across midnight.
  useEffect(() => {
    const sync = () => {
      const key = sydneyTodayKey();
      setTodayKey((prev) => (prev === key ? prev : key));
      if (weekPinned) return;
      const week = isoLastCompletedPayWeek();
      setWeekMondayISO((prev) => (prev === week ? prev : week));
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    const timer = window.setInterval(sync, DATE_ROLL_POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", sync);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", sync);
    };
  }, [weekPinned]);

  useEffect(() => {
    if (!allowed || !weekMondayISO) return;
    let cancelled = false;
    const cacheKey = `y.payroll.summary.v10.${weekMondayISO}`;
    const cached = readSession<SummaryPayload>(cacheKey);
    const cachedHasPayroll = cached && (cached.current?.totals?.totalIncSuper ?? 0) > 0;
    setSummary(cachedHasPayroll ? cached : null);
    setError(null);
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
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allowed, weekMondayISO]);

  /** Payroll in dollars against the week before, as a percentage change. */
  const costChange = useMemo(() => {
    if (!summary) return null;
    return safePct(summary.current.totals.totalIncSuper, summary.previous.totals.totalIncSuper);
  }, [summary]);

  /** Share of sales against the week before, in percentage points. */
  const pctChangePp = useMemo(() => {
    if (summary?.payrollPctSales == null || summary.payrollPctPrev == null) return null;
    return summary.payrollPctSales - summary.payrollPctPrev;
  }, [summary]);

  if (authLoading || !user || !allowed) return <Splash />;

  const totals = summary?.current.totals;
  const pct = summary?.payrollPctSales ?? null;
  const overBy = pct === null ? null : pct - PAYROLL_TARGET_PCT;

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <button type="button" className={styles.backBtn} onClick={goBack} aria-label="Back">
          <ChevronLeft />
        </button>
        <div className={styles.headerTitles}>
          <h1 className={styles.pageTitle}>Payroll Cost</h1>
          <p className={styles.pageSubtitle}>Total weekly payroll and sales percentage.</p>
        </div>
      </header>

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

      {calendarOpen && (
        <CalendarPicker
          value={weekMondayISO}
          maxDate={todayKey}
          singleOnly
          onChange={(pickedISO) => {
            // Snap the picked day to its Monday so a full Mon–Sun week is read.
            setWeekMondayISO(isoMondayOf(pickedISO));
            setWeekPinned(true);
            setCalendarOpen(false);
          }}
          onRangeChange={() => {
            /* range mode disabled via singleOnly */
          }}
          onClose={() => setCalendarOpen(false)}
        />
      )}

      {/* ── Payroll cost + its share of sales ── */}
      <div className={styles.heroGrid}>
        <section className={styles.heroCard}>
          <div className={styles.heroHead}>
            <p className={styles.heroLabel}>PAYROLL COST</p>
            <span className={styles.heroBadge} aria-hidden="true"><WalletIcon /></span>
          </div>
          <p className={styles.heroValue}>{totals ? fmtCurrency(totals.totalIncSuper) : "—"}</p>
          <HeroDelta value={costChange} unit="%" />
        </section>

        <section className={styles.heroCard}>
          <div className={styles.heroHead}>
            <p className={styles.heroLabel}>% OF SALES</p>
            <InfoIcon />
          </div>
          <div className={styles.heroPctRow}>
            <p className={styles.heroValue}>
              {pct !== null ? pct.toFixed(1) : "—"}
              <span className={styles.heroUnit}>%</span>
            </p>
            <GaugeChart pct={pct} />
          </div>
          <HeroDelta value={pctChangePp} unit=" pp" />
        </section>
      </div>

      {error && <p className={styles.errorMsg}>{error}</p>}

      {/* ── Sales the ratio is taken against, and the target ── */}
      <section className={styles.factsCard}>
        <div className={styles.factCol}>
          <p className={styles.factLabel}>
            <BarsIcon />
            WEEKLY SALES
          </p>
          <p className={styles.factValue}>{summary ? fmtCurrency(summary.sales.current) : "—"}</p>
        </div>
        <span className={styles.factDivider} aria-hidden="true" />
        <div className={styles.factCol}>
          <p className={styles.factLabel}>PAYROLL TARGET</p>
          <p className={styles.factValue}>≤ {PAYROLL_TARGET_PCT.toFixed(1)}%</p>
        </div>
      </section>

      {overBy !== null && pct !== null && (
        <section className={overBy > 0 ? styles.targetAlert : styles.targetOk}>
          <span className={styles.targetIcon} aria-hidden="true">
            {overBy > 0 ? <AlertIcon /> : <CheckIcon />}
          </span>
          <div>
            <p className={styles.targetTitle}>
              {overBy > 0
                ? `Above target by ${overBy.toFixed(1)} pp`
                : `Within target by ${Math.abs(overBy).toFixed(1)} pp`}
            </p>
            <p className={styles.targetSub}>
              Target ≤ {PAYROLL_TARGET_PCT.toFixed(1)}%
              <span className={styles.targetSep} aria-hidden="true">|</span>
              Current {pct.toFixed(1)}%
            </p>
          </div>
        </section>
      )}
    </div>
  );
}

/* ── Sub-components ── */

/** Rising cost is the bad direction, so up reads warm and down reads positive. */
function HeroDelta({ value, unit }: { value: number | null; unit: string }) {
  return (
    <div className={styles.heroFoot}>
      <div className={styles.heroDivider} />
      {value !== null ? (
        <p className={value >= 0 ? styles.heroDeltaUp : styles.heroDeltaDown}>
          {value >= 0 ? "↑" : "↓"} {Math.abs(value).toFixed(1)}
          {unit}
        </p>
      ) : (
        <p className={styles.heroDeltaMuted}>—</p>
      )}
      <p className={styles.heroDeltaSub}>vs previous week</p>
    </div>
  );
}

/** Ring only — the percentage is printed beside it. */
function GaugeChart({ pct }: { pct: number | null }) {
  const radius = 44;
  const stroke = 12;
  const circumference = 2 * Math.PI * radius;
  const capped = pct === null ? 0 : Math.max(0, Math.min(pct, 100));
  const fillLen = (capped / 100) * circumference;
  return (
    <div className={styles.gauge}>
      <svg viewBox="0 0 120 120" className={styles.gaugeSvg} aria-hidden="true">
        <circle cx={60} cy={60} r={radius} fill="none" className={styles.gaugeTrack} strokeWidth={stroke} />
        {pct !== null && (
          <circle
            cx={60}
            cy={60}
            r={radius}
            fill="none"
            className={styles.gaugeFill}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${fillLen} ${circumference - fillLen}`}
            transform="rotate(-90 60 60)"
          />
        )}
      </svg>
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
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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

function BarsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="3" y="13" width="4.5" height="8" rx="1" />
      <rect x="9.75" y="9" width="4.5" height="12" rx="1" />
      <rect x="16.5" y="4" width="4.5" height="17" rx="1" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="7" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polyline points="8 12.5 11 15.5 16.5 9.5" />
    </svg>
  );
}
