"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useBackToDashboard } from "@/hooks/useBackToDashboard";
import {
  DISH_FILTER_LABELS,
  filterDishes,
  fmtDelta,
  weekRangeLabel,
  weekTitle,
  type DishFilter,
  type MenuWeek,
} from "@/lib/menu-performance";
import { isOwnerOrChef } from "@/lib/permissions";
import { addDaysISO, isoMondayOf, sydneyTodayKey } from "@/lib/sydney-date";
import styles from "./page.module.css";

/** Rows shown before "View all". The top of the list is what the page is for. */
const TOP_ROWS = 5;

/** Give up on the read rather than leave the page on its loading line. */
const FETCH_TIMEOUT_MS = 30 * 1000;

/** How far back the arrows go. Square has the orders; a year is enough to ask. */
const WEEKS_BACK = 52;

const FILTERS: DishFilter[] = ["all", "food", "drinks"];

function BackIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function CalIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="16.5" rx="2" />
      <line x1="16" y1="2.5" x2="16" y2="6.5" />
      <line x1="8" y1="2.5" x2="8" y2="6.5" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function ArrowIcon({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points={dir === "left" ? "15 18 9 12 15 6" : "9 18 15 12 9 6"} />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

/** The triangle beside a change, pointing the way it went. */
function DeltaCell({ pct }: { pct: number | null }) {
  if (pct === null) return <span className={styles.deltaFlat}>—</span>;
  const rounded = Math.round(pct);
  if (rounded === 0) return <span className={styles.deltaFlat}>0%</span>;
  const up = rounded > 0;
  return (
    <span className={up ? styles.deltaUp : styles.deltaDown}>
      <span aria-hidden="true">{up ? "▲" : "▼"}</span> {fmtDelta(pct)}
    </span>
  );
}

export default function MenuPerformancePage() {
  const goBack = useBackToDashboard();
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwnerOrChef(user);

  const thisMonday = useMemo(() => isoMondayOf(sydneyTodayKey()), []);
  const earliestMonday = useMemo(() => addDaysISO(thisMonday, -7 * WEEKS_BACK), [thisMonday]);

  const [weekStart, setWeekStart] = useState(thisMonday);
  /** Weeks already fetched, so stepping back and forth does not re-read Square. */
  const [weeks, setWeeks] = useState<Record<string, MenuWeek>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filter, setFilter] = useState<DishFilter>("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);

  const week = weeks[weekStart] ?? null;

  const load = useCallback(
    async (monday: string) => {
      if (!user) return;
      setLoading(true);
      setError(null);
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS);
      try {
        const idToken = await user.getIdToken();
        const res = await fetch(`/api/square/menu-performance?weekStart=${monday}`, {
          headers: { Authorization: `Bearer ${idToken}` },
          signal: abort.signal,
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload?.error ?? `Failed (${res.status}).`);
        const data = payload as MenuWeek;
        setWeeks((current) => ({ ...current, [data.weekStart]: data }));
      } catch (err) {
        const timedOut = err instanceof DOMException && err.name === "AbortError";
        setError(
          timedOut
            ? "The week's sales took too long to load."
            : err instanceof Error
              ? err.message
              : String(err),
        );
      } finally {
        clearTimeout(timer);
        setLoading(false);
      }
    },
    [user],
  );

  useEffect(() => {
    if (authLoading || !allowed) return;
    if (weeks[weekStart]) {
      setLoading(false);
      return;
    }
    void load(weekStart);
    // `weeks` is deliberately not a dependency: it changes when the fetch
    // lands, and re-running then would ask for the week already in hand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, allowed, weekStart, load]);

  // A different week, tab or search starts from the top five again.
  useEffect(() => {
    setExpanded(false);
  }, [weekStart, filter, query]);

  const shown = useMemo(
    () => (week ? filterDishes(week.dishes, filter, query) : []),
    [week, filter, query],
  );

  if (authLoading || !allowed) return null;

  const searching = query.trim().length > 0;
  // A search is a question about the whole menu, so it answers with all of it.
  const rows = expanded || searching ? shown : shown.slice(0, TOP_ROWS);
  const canExpand = !searching && shown.length > TOP_ROWS;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button type="button" className={styles.backBtn} aria-label="Back" onClick={goBack}>
          <BackIcon />
        </button>
        <h1 className={styles.title}>Menu Performance</h1>
      </header>

      <section className={styles.weekBar}>
        <button
          type="button"
          className={styles.weekArrow}
          aria-label="Previous week"
          disabled={weekStart <= earliestMonday}
          onClick={() => setWeekStart(addDaysISO(weekStart, -7))}
        >
          <ArrowIcon dir="left" />
        </button>
        <div className={styles.weekLabel}>
          <p className={styles.weekName}>
            <span className={styles.weekIcon}>
              <CalIcon />
            </span>
            {weekTitle(weekStart, thisMonday)}
          </p>
          <p className={styles.weekDates}>{weekRangeLabel(weekStart, addDaysISO(weekStart, 6))}</p>
        </div>
        <button
          type="button"
          className={styles.weekArrow}
          aria-label="Next week"
          disabled={weekStart >= thisMonday}
          onClick={() => setWeekStart(addDaysISO(weekStart, 7))}
        >
          <ArrowIcon dir="right" />
        </button>
      </section>

      <section className={styles.stats}>
        <div className={styles.statCard}>
          <p className={styles.statLabel}>Total Sales</p>
          <p className={styles.statValue}>{week ? week.totalQty.toLocaleString("en-AU") : "—"}</p>
          <p className={styles.statSub}>items</p>
        </div>
        <div className={styles.statCard}>
          <p className={styles.statLabel}>vs. Last Week</p>
          <p className={styles.statValue}>
            {week ? <DeltaCell pct={week.totalDeltaPct} /> : "—"}
          </p>
        </div>
        <div className={styles.statCard}>
          <p className={styles.statLabel}># of Dishes</p>
          <p className={styles.statValue}>{week ? week.dishCount.toLocaleString("en-AU") : "—"}</p>
        </div>
      </section>

      <div className={styles.tabs} role="group" aria-label="Menu section">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={`${styles.tab} ${filter === f ? styles.tabActive : ""}`}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {DISH_FILTER_LABELS[f]}
          </button>
        ))}
      </div>

      <div className={styles.searchBox}>
        <span className={styles.searchIcon}>
          <SearchIcon />
        </span>
        <input
          className={styles.searchInput}
          type="text"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Search dish (e.g. Salmon, Agedashi)"
          aria-label="Search dish"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {error ? (
        <div className={styles.state}>
          <p className={styles.stateText}>{error}</p>
          <button type="button" className={styles.retryBtn} onClick={() => void load(weekStart)}>
            Try again
          </button>
        </div>
      ) : loading && !week ? (
        <p className={styles.state}>Loading the week&apos;s sales…</p>
      ) : rows.length === 0 ? (
        <p className={styles.state}>
          {searching
            ? `No dish matches “${query.trim()}”.`
            : filter === "all"
              ? "Nothing was sold this week."
              : `No ${DISH_FILTER_LABELS[filter].toLowerCase()} sold this week.`}
        </p>
      ) : (
        <>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thRank} scope="col">#</th>
                <th className={styles.thDish} scope="col">Dish</th>
                <th className={styles.thQty} scope="col">
                  Qty Sold <span aria-hidden="true">▾</span>
                </th>
                <th className={styles.thDelta} scope="col">vs. Last Week</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d, i) => (
                <tr key={d.name}>
                  <td className={styles.tdRank}>{i + 1}</td>
                  <td className={styles.tdDish}>{d.name}</td>
                  <td className={styles.tdQty}>{d.qty.toLocaleString("en-AU")}</td>
                  <td className={styles.tdDelta}>
                    <DeltaCell pct={d.deltaPct} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {canExpand && (
            <button type="button" className={styles.viewAllBtn} onClick={() => setExpanded(true)}>
              View All {shown.length.toLocaleString("en-AU")} Dishes <span aria-hidden="true">›</span>
            </button>
          )}
          {expanded && !searching && (
            <button type="button" className={styles.viewAllBtn} onClick={() => setExpanded(false)}>
              Show Top {TOP_ROWS}
            </button>
          )}
        </>
      )}

      {loading && week && <p className={styles.refreshing}>Updating…</p>}
    </div>
  );
}
