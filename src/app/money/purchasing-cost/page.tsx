"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useAuth } from "@/components/AuthProvider";
import { isOwner } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import { isoLastCompletedPayWeek, sydneyTodayKey } from "@/lib/owner-money-prefetch";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

// Week picker is only mounted after the owner taps the date pill — keep
// it out of the initial bundle.
const CalendarPicker = dynamic(() => import("@/components/CalendarPicker"), {
  ssr: false,
});

/**
 * Owner Supplier Cost overview — reads from
 * /api/money/purchasing-cost/summary, which pulls the selected Mon–Sun
 * week of supplier spend from the shared Google Sheet plus the week before
 * it, and joins the matching Sydney-week Gross Sales so the
 * "% of sales" gauge is meaningful.
 */

type SupplierRow = { name: string; cost: number; pctOfTotal: number };

type WeekView = {
  weekStart: string;
  weekEnd: string;
  total: number;
  activeSuppliers: number;
  suppliers: SupplierRow[];
};

type SummaryPayload = {
  weekStart: string;
  weekEnd: string;
  current: WeekView;
  previous: WeekView;
  sales: { current: number; previous: number };
  costPctSales: number | null;
  costPctSalesPrev: number | null;
  target: number;
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
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

function fmtWeekRange(mondayISO: string): string {
  const sundayISO = addDaysISO(mondayISO, 6);
  const [my, mm, md] = mondayISO.split("-").map(Number);
  const [sy, sm, sd] = sundayISO.split("-").map(Number);
  const mon = new Date(Date.UTC(my, mm - 1, md, 12));
  const sun = new Date(Date.UTC(sy, sm - 1, sd, 12));
  // en-GB, not en-AU: both are day-first, but en-AU spells out "June"/"July"
  // for `month: "short"`, which makes the heading noticeably wider.
  const monPart = `${md} ${mon.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}`;
  const sunPart = sun.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${monPart} – ${sunPart}`;
}

function fmtCurrency(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function safePct(current: number, baseline: number): number | null {
  if (!Number.isFinite(baseline) || baseline === 0) return null;
  return ((current - baseline) / baseline) * 100;
}

function topSupplier(week: WeekView | undefined): SupplierRow | null {
  return week?.suppliers[0] ?? null;
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

export default function PurchasingCostPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwner(user);

  const [weekMondayISO, setWeekMondayISO] = useState(isoLastCompletedPayWeek);
  const [todayKey] = useState(sydneyTodayKey);
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) return;
    if (!allowed) router.replace(ROUTES.home);
  }, [allowed, authLoading, user, router]);

  useEffect(() => {
    if (!allowed || !weekMondayISO) return;
    let cancelled = false;
    const cacheKey = `y.supplierCost.summary.v2.${weekMondayISO}`;
    const cached = readSession<SummaryPayload>(cacheKey);
    if (cached && cached.current.total > 0) {
      setSummary(cached);
    } else {
      setSummary(null);
    }
    setError(null);
    setFetching(!cached);
    (async () => {
      try {
        const res = await fetch(`/api/money/purchasing-cost/summary?weekStart=${weekMondayISO}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as SummaryPayload;
        if (cancelled) return;
        setSummary(data);
        writeSession(cacheKey, data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load supplier cost");
        }
      } finally {
        if (!cancelled) setFetching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allowed, weekMondayISO]);

  const current = summary?.current;
  const previous = summary?.previous;

  const deltas = useMemo(() => {
    if (!summary) return null;
    const curTop = topSupplier(summary.current);
    const prevTop = topSupplier(summary.previous);
    return {
      total: safePct(summary.current.total, summary.previous.total),
      sales: safePct(summary.sales.current, summary.sales.previous),
      pctSales:
        summary.costPctSales !== null && summary.costPctSalesPrev !== null
          ? safePct(summary.costPctSales, summary.costPctSalesPrev)
          : null,
      topSpend: safePct(curTop?.cost ?? 0, prevTop?.cost ?? 0),
    };
  }, [summary]);

  const top5 = useMemo(() => current?.suppliers.slice(0, 5) ?? [], [current]);

  if (authLoading || !user || !allowed) return <Splash />;

  const curTop = topSupplier(current);
  const prevTop = topSupplier(previous);

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
          <h1 className={styles.pageTitle}>Supplier Cost</h1>
          <p className={styles.pageSubtitle}>Food, beverage and consumable purchases.</p>
        </div>
        <button
          type="button"
          className={styles.datePill}
          onClick={() => setCalendarOpen(true)}
          aria-label="Pick a week"
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

      {/* ── Headline cost + ratio ── */}
      <div className={styles.heroGrid}>
        <section className={styles.heroCard}>
          <div className={styles.heroHead}>
            <p className={styles.heroLabel}>PURCHASING COST</p>
            <span className={styles.heroBadge} aria-hidden="true"><BoxIcon /></span>
          </div>
          <p className={styles.heroValue}>{current ? fmtCurrency(current.total) : "—"}</p>
          <HeroFoot pct={deltas?.total ?? null} sub="vs previous week" />
        </section>

        <section className={styles.heroCard}>
          <div className={styles.heroHead}>
            <p className={styles.heroLabel}>% OF SALES</p>
            <InfoIcon />
          </div>
          <div className={styles.heroPctRow}>
            <p className={styles.heroValue}>
              {summary?.costPctSales != null ? summary.costPctSales.toFixed(1) : "—"}
              <span className={styles.heroUnit}>%</span>
            </p>
            <GaugeChart pct={summary?.costPctSales ?? null} />
          </div>
          <HeroFoot
            pct={deltas?.pctSales ?? null}
            sub={summary ? `Target ${summary.target}%` : "Target —"}
          />
        </section>
      </div>

      {error && <p className={styles.errorMsg}>{error}</p>}

      {/* ── Week at a glance ── */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <p className={styles.cardTitle}>
            OVERVIEW <span className={styles.cardTitleSub}>(Last Week)</span>
          </p>
          <p className={styles.cardTitleRange}>
            {summary ? fmtWeekRange(summary.current.weekStart) : ""}
          </p>
        </div>

        <div className={styles.summaryGrid}>
          <Tile
            icon={<SalesIcon />}
            label="Sales"
            value={summary ? fmtCurrency(summary.sales.current) : "—"}
            deltaPct={deltas?.sales ?? null}
            sub="vs previous week"
            loading={fetching && !summary}
          />
          <Tile
            icon={<TruckIcon />}
            label="Active Suppliers"
            value={current ? String(current.activeSuppliers) : "—"}
            sub="invoiced this week"
            loading={fetching && !summary}
          />
          <Tile
            icon={<CrownIcon />}
            label="Top Supplier"
            value={curTop ? curTop.name : "—"}
            sub={curTop ? fmtCurrency(curTop.cost) : ""}
            loading={fetching && !summary}
          />
        </div>
      </section>

      {/* ── Weekly comparison ── */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <p className={styles.cardTitle}>LAST WEEK VS PREVIOUS WEEK</p>
        </div>

        <div className={styles.compareHead}>
          <span />
          <span className={styles.compareHeadHot}>
            {summary ? fmtWeekRange(summary.current.weekStart).split(" – ")[0] : "—"}
          </span>
          <span className={styles.compareHeadLabel}>
            {summary ? fmtWeekRange(summary.previous.weekStart).split(" – ")[0] : "—"}
          </span>
        </div>

        <CompareRow
          name="Total Purchasing Cost"
          now={current ? fmtCurrency(current.total) : "—"}
          then={previous ? fmtCurrency(previous.total) : "—"}
          bold
        />
        <CompareRow
          name="Purchasing % of Sales"
          now={summary?.costPctSales != null ? `${summary.costPctSales.toFixed(1)}%` : "—"}
          then={summary?.costPctSalesPrev != null ? `${summary.costPctSalesPrev.toFixed(1)}%` : "—"}
        />
        <CompareRow
          name="Sales"
          now={summary ? fmtCurrency(summary.sales.current) : "—"}
          then={summary ? fmtCurrency(summary.sales.previous) : "—"}
        />
        <div className={styles.compareDivider} />
        <CompareRow
          name="Top Supplier Spend"
          now={curTop ? fmtCurrency(curTop.cost) : "—"}
          then={prevTop ? fmtCurrency(prevTop.cost) : "—"}
        />
      </section>

      {/* ── Top suppliers ── */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <p className={styles.cardTitle}>
            TOP SUPPLIERS <span className={styles.cardTitleSub}>(Last Week)</span>
          </p>
        </div>
        {top5.length === 0 ? (
          <p className={styles.listEmpty}>
            {fetching ? "Loading…" : "No supplier purchases recorded for this week yet."}
          </p>
        ) : (
          <ol className={styles.rankList}>
            {top5.map((s, idx) => (
              <li key={s.name} className={styles.rankItem}>
                <span className={idx === 0 ? styles.rankHot : styles.rank}>{idx + 1}</span>
                <span className={styles.rankName}>{s.name}</span>
                <span className={styles.rankCost}>{fmtCurrency(s.cost)}</span>
                <span className={styles.rankBarTrack}>
                  <span className={styles.rankBarFill} style={{ width: `${s.pctOfTotal}%` }} />
                </span>
                <span className={styles.rankPct}>{s.pctOfTotal.toFixed(1)}% of spend</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

/* ── Sub-components ── */

/** Rising purchasing cost is the bad direction, so up reads warm and down reads positive. */
function HeroFoot({ pct, sub }: { pct: number | null; sub: string }) {
  return (
    <div className={styles.heroFoot}>
      <div className={styles.heroDivider} />
      {pct !== null ? (
        <p className={pct >= 0 ? styles.heroDeltaUp : styles.heroDeltaDown}>
          {pct >= 0 ? "↑" : "↓"} {Math.abs(pct).toFixed(1)}%
        </p>
      ) : (
        <p className={styles.heroDeltaMuted}>—</p>
      )}
      <p className={styles.heroDeltaSub}>{sub}</p>
    </div>
  );
}

function Tile({
  icon,
  label,
  value,
  deltaPct = null,
  sub,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  deltaPct?: number | null;
  sub: string;
  loading: boolean;
}) {
  return (
    <div className={styles.tile}>
      <span className={styles.tileIcon} aria-hidden="true">{icon}</span>
      <p className={styles.tileLabel}>{label}</p>
      <p className={styles.tileValue}>{loading ? "…" : value}</p>
      {deltaPct !== null && (
        <p className={deltaPct >= 0 ? styles.tileDeltaUp : styles.tileDeltaDown}>
          {deltaPct >= 0 ? "↑" : "↓"} {Math.abs(deltaPct).toFixed(1)}%
        </p>
      )}
      <p className={styles.tileDeltaSub}>{sub}</p>
    </div>
  );
}

function CompareRow({
  name,
  now,
  then,
  bold = false,
}: {
  name: string;
  now: string;
  then: string;
  bold?: boolean;
}) {
  return (
    <div className={styles.compareRow}>
      <span className={bold ? styles.compareNameBold : styles.compareName}>{name}</span>
      <span className={styles.compareValueHot}>{now}</span>
      <span className={styles.compareValue}>{then}</span>
    </div>
  );
}

/**
 * Ring only — the percentage itself is already printed beside it as the
 * hero value, so repeating it inside the ring just duplicated the number.
 */
function GaugeChart({ pct }: { pct: number | null }) {
  const radius = 44;
  const stroke = 12;
  const circumference = 2 * Math.PI * radius;
  const capped = pct === null ? 0 : Math.max(0, Math.min(pct, 100));
  const fillLen = (capped / 100) * circumference;
  return (
    <div className={styles.gauge}>
      <svg viewBox="0 0 120 120" className={styles.gaugeSvg} aria-hidden="true">
        <circle
          cx={60}
          cy={60}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.15)"
          strokeWidth={stroke}
        />
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

function BoxIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 8 12 3 3 8v8l9 5 9-5Z" />
      <path d="m3 8 9 5 9-5" />
      <path d="M12 13v8" />
    </svg>
  );
}

function SalesIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 17 9 11 13 15 21 7" />
      <polyline points="15 7 21 7 21 13" />
    </svg>
  );
}

function TruckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7h11v9H3Z" />
      <path d="M14 10h4l3 3v3h-7Z" />
      <circle cx="7" cy="18" r="1.6" />
      <circle cx="17" cy="18" r="1.6" />
    </svg>
  );
}

function CrownIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8l4 4 5-7 5 7 4-4-2 11H5Z" />
    </svg>
  );
}
