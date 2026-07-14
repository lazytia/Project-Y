"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { isOwner } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

/**
 * Owner Suppliers overview — /api/money/suppliers/summary combines
 * owner-maintained supplier costs (suppliers_monthly Firestore
 * collection) with monthly Sydney-Gross Sales so the top-of-page gauge
 * is real. Empty state still renders sensibly when no month data is
 * seeded yet, so the layout doesn't collapse.
 */

const SYDNEY_TZ = "Australia/Sydney";

type SupplierRow = { name: string; cost: number; pctOfTotal: number };
type TrendPoint = { month: string; label: string; cost: number };
type ComparisonRow = {
  name: string;
  thisMonth: number;
  lastMonth: number;
  twoMonthsAgo: number;
};

type SummaryPayload = {
  month: string;
  prevMonth: string;
  prevMonthLabel: string;
  currentTotal: number;
  prevTotal: number;
  currentSales: number;
  costPctSales: number | null;
  vsPrevPctSales: number | null;
  vsPrev: number | null;
  target: number;
  suppliers: SupplierRow[];
  monthlyTrend: TrendPoint[];
  comparison: ComparisonRow[];
};

/* ── Date helpers ── */

function sydneyMonthKey(): string {
  const d = new Date().toLocaleDateString("en-CA", { timeZone: SYDNEY_TZ });
  return d.slice(0, 7);
}

function monthLabel(monthISO: string): string {
  const [y, m] = monthISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-AU", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function fmtCurrency(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtCompact(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(n / 1000 >= 10 ? 0 : 1) + "K";
  return String(Math.round(n));
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

export default function SuppliersPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwner(user);

  const [monthISO, setMonthISO] = useState<string>("");
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!allowed) router.replace(ROUTES.home);
  }, [allowed, authLoading, router]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setMonthISO(sydneyMonthKey());
  }, []);

  useEffect(() => {
    if (!allowed || !monthISO) return;
    let cancelled = false;
    const cacheKey = `y.suppliers.summary.v1.${monthISO}`;
    const cached = readSession<SummaryPayload>(cacheKey);
    if (cached) setSummary(cached);
    else setSummary(null);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/money/suppliers/summary?month=${monthISO}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as SummaryPayload;
        if (cancelled) return;
        setSummary(data);
        writeSession(cacheKey, data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load suppliers");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allowed, monthISO]);

  const topFive = useMemo(() => (summary?.suppliers ?? []).slice(0, 5), [summary]);
  // "Others" bucket for the spend-portion chart so tiny suppliers don't
  // clutter the layout while still adding up to 100 %.
  const spendPortion = useMemo(() => {
    const all = summary?.suppliers ?? [];
    if (all.length <= 7) return all;
    const shown = all.slice(0, 6);
    const othersPct =
      100 - shown.reduce((s, r) => s + r.pctOfTotal, 0);
    const othersCost = all.slice(6).reduce((s, r) => s + r.cost, 0);
    return [
      ...shown,
      {
        name: "Others",
        cost: Math.round(othersCost * 100) / 100,
        pctOfTotal: Math.max(0, Math.round(othersPct * 10) / 10),
      },
    ];
  }, [summary]);

  if (authLoading || !allowed) return <Splash />;

  const totalCost = summary?.currentTotal ?? 0;
  const costPctSales = summary?.costPctSales ?? null;
  const vsPrevPctSales = summary?.vsPrevPctSales ?? null;
  const vsPrev = summary?.vsPrev ?? null;
  const target = summary?.target ?? 28;
  const prevLabel = summary?.prevMonthLabel ?? "prev";
  const prevTotal = summary?.prevTotal ?? 0;

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
          <h1 className={styles.pageTitle}>Suppliers</h1>
          <p className={styles.pageSubtitle}>Overview of supplier spending.</p>
        </div>
        <button type="button" className={styles.datePill} aria-label="Pick month">
          <CalendarIcon />
          <span className={styles.datePillLabel}>
            {monthISO ? monthLabel(monthISO) : "—"}
          </span>
          <span className={styles.datePillChevron} aria-hidden="true">▾</span>
        </button>
      </header>

      {/* ── Cost % of sales + total ── */}
      <section className={styles.headerStrip}>
        <div className={styles.pctSide}>
          <p className={styles.stripLabel}>
            SUPPLIER COST % OF SALES <InfoIcon />
          </p>
          <p className={styles.pctBig}>
            {costPctSales !== null ? costPctSales.toFixed(1) : "—"}
            <span className={styles.pctBigUnit}>%</span>
          </p>
          {vsPrevPctSales !== null && (
            <span className={styles.pctChip}>
              {vsPrevPctSales >= 0 ? "↑" : "↓"} {Math.abs(vsPrevPctSales).toFixed(1)}%{" "}
              <span className={styles.pctChipSub}>vs {prevLabel}</span>
            </span>
          )}
          <p className={styles.targetLine}>Target {target}%</p>
        </div>
        <div className={styles.stripDivider} aria-hidden="true" />
        <div className={styles.totalSide}>
          <p className={styles.stripLabel}>TOTAL SUPPLIER COST</p>
          <p className={styles.totalBig}>{fmtCurrency(totalCost)}</p>
          {vsPrev !== null && (
            <span className={styles.pctChip}>
              {vsPrev >= 0 ? "↑" : "↓"} {Math.abs(vsPrev).toFixed(1)}%{" "}
              <span className={styles.pctChipSub}>
                vs {prevLabel} ({fmtCurrency(prevTotal)})
              </span>
            </span>
          )}
        </div>
      </section>

      {error && <p className={styles.errorMsg}>{error}</p>}

      {/* ── Largest supplier + spend portion (two-up on desktop) ── */}
      <div className={styles.twoUp}>
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <p className={styles.cardTitle}>
              LARGEST SUPPLIER{" "}
              <span className={styles.cardTitleSub}>(THIS MONTH)</span>
            </p>
          </div>
          <ol className={styles.largestList}>
            {topFive.length === 0 && (
              <li className={styles.emptyRow}>No supplier data for this month.</li>
            )}
            {topFive.map((row, idx) => (
              <li key={row.name} className={styles.largestItem}>
                <span
                  className={idx === 0 ? styles.rankHot : styles.rank}
                  aria-hidden="true"
                >
                  {idx + 1}
                </span>
                <span className={styles.largestName}>{row.name}</span>
                <span className={styles.largestCost}>{fmtCurrency(row.cost)}</span>
                <span className={styles.largestPct}>{row.pctOfTotal.toFixed(1)}%</span>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.card}>
          <div className={styles.cardHead}>
            <p className={styles.cardTitle}>SUPPLIER SPEND PORTION</p>
          </div>
          <ul className={styles.portionList}>
            {spendPortion.length === 0 && (
              <li className={styles.emptyRow}>No supplier data.</li>
            )}
            {spendPortion.map((row) => (
              <li key={row.name} className={styles.portionItem}>
                <span className={styles.portionName}>{row.name}</span>
                <span className={styles.portionBarTrack} aria-hidden="true">
                  <span
                    className={styles.portionBarFill}
                    style={{ width: `${Math.max(0, Math.min(row.pctOfTotal, 100))}%` }}
                  />
                </span>
                <span className={styles.portionPct}>{row.pctOfTotal.toFixed(1)}%</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* ── Monthly trend ── */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <p className={styles.cardTitle}>MONTHLY SPEND TREND</p>
        </div>
        <TrendChart points={summary?.monthlyTrend ?? []} />
      </section>

      {/* ── Comparison table ── */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <p className={styles.cardTitle}>SUPPLIER COMPARISON</p>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thLeft}>Supplier</th>
                <th className={styles.thRight}>This Month</th>
                <th className={styles.thRight}>Last Month</th>
                <th className={styles.thRight}>2 Months Ago</th>
              </tr>
            </thead>
            <tbody>
              {(summary?.comparison ?? []).length === 0 ? (
                <tr>
                  <td colSpan={4} className={styles.tableEmpty}>
                    No supplier records yet.
                  </td>
                </tr>
              ) : (
                (summary?.comparison ?? []).map((row) => (
                  <tr key={row.name}>
                    <td className={styles.tdLeft}>{row.name}</td>
                    <td className={styles.tdRight}>{fmtCurrency(row.thisMonth)}</td>
                    <td className={styles.tdRight}>{fmtCurrency(row.lastMonth)}</td>
                    <td className={styles.tdRight}>{fmtCurrency(row.twoMonthsAgo)}</td>
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

/* ── Trend chart (SVG line) ── */

function TrendChart({ points }: { points: TrendPoint[] }) {
  const { path, maxVal, ticks, coordsForPoint } = useMemo(() => {
    if (points.length === 0) {
      return { path: "", maxVal: 0, ticks: [] as number[], coordsForPoint: [] as { x: number; y: number; label: string; cost: number }[] };
    }
    const width = 340;
    const height = 160;
    const padL = 42;
    const padR = 12;
    const padT = 20;
    const padB = 26;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const maxCost = Math.max(...points.map((p) => p.cost), 0);
    // Nice-scale to 10K/20K/30K/40K style ticks.
    const targetTicks = 4;
    const rough = maxCost / targetTicks || 1;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const resid = rough / mag;
    const step = resid <= 1 ? mag : resid <= 2 ? 2 * mag : resid <= 5 ? 5 * mag : 10 * mag;
    const niceMax = Math.max(step * targetTicks, Math.ceil(maxCost / step) * step);
    const ticks: number[] = [];
    for (let v = 0; v <= niceMax + 1e-9; v += step) ticks.push(v);
    const coords = points.map((p, i) => {
      const x =
        points.length === 1
          ? padL + plotW / 2
          : padL + (i / (points.length - 1)) * plotW;
      const y = padT + plotH * (1 - p.cost / (niceMax || 1));
      return { x, y, label: p.label, cost: p.cost };
    });
    const path = coords
      .map((c, i) => (i === 0 ? `M ${c.x} ${c.y}` : `L ${c.x} ${c.y}`))
      .join(" ");
    return { path, maxVal: niceMax, ticks, coordsForPoint: coords };
  }, [points]);

  const width = 340;
  const height = 160;
  const padL = 42;
  const padR = 12;
  const padT = 20;
  const padB = 26;

  return (
    <div className={styles.trendWrap}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className={styles.trendSvg}
        role="img"
        aria-label="Monthly spend trend"
      >
        {/* Gridlines + Y ticks */}
        {ticks.map((t) => {
          const y = padT + (height - padT - padB) * (1 - t / (maxVal || 1));
          return (
            <g key={t}>
              <line
                x1={padL}
                y1={y}
                x2={width - padR}
                y2={y}
                className={styles.trendGrid}
              />
              <text x={padL - 6} y={y + 3} className={styles.trendYLabel} textAnchor="end">
                {t === 0 ? "0" : `$${fmtCompact(t)}`}
              </text>
            </g>
          );
        })}
        {/* Line */}
        {path && <path d={path} className={styles.trendLine} />}
        {/* Points + value labels */}
        {coordsForPoint.map((c, i) => (
          <g key={i}>
            <circle cx={c.x} cy={c.y} r={3.5} className={styles.trendDot} />
            <text
              x={c.x}
              y={c.y - 8}
              textAnchor="middle"
              className={styles.trendValueLabel}
            >
              {c.cost > 0 ? `${fmtCompact(c.cost)}` : ""}
            </text>
            <text
              x={c.x}
              y={height - 8}
              textAnchor="middle"
              className={styles.trendXLabel}
            >
              {c.label}
            </text>
          </g>
        ))}
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
