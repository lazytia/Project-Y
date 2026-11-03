"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import Splash from "@/components/Splash";
import { isStrictOwner } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import {
  BOOKING_SOURCE_PERIODS,
  BOOKING_SOURCE_ROWS,
  DEFAULT_BOOKING_SOURCE_PERIOD,
  type BookingSourcePeriod,
  type BookingSourceSummary,
} from "@/lib/booking-sources";
import styles from "./page.module.css";

const TRACKING_STARTED = "3 Nov";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export default function BookingSourcesPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const allowed = isStrictOwner(user);

  const [days, setDays] = useState<BookingSourcePeriod>(DEFAULT_BOOKING_SOURCE_PERIOD);
  const [summary, setSummary] = useState<BookingSourceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!allowed || !user) {
      router.replace(ROUTES.home);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const idToken = await user.getIdToken();
        const res = await fetch(`/api/reservations/sources?days=${days}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "Could not load booking sources.");
        if (!cancelled) setSummary(data as BookingSourceSummary);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load booking sources.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, allowed, user, days, router]);

  const rows = useMemo(() => {
    if (!summary) return [];
    return BOOKING_SOURCE_ROWS.map((row) => {
      const count = row.sources.reduce((sum, id) => sum + (summary.sources[id] ?? 0), 0);
      const percent = summary.total > 0 ? Math.round((count / summary.total) * 100) : 0;
      return { ...row, count, percent };
    }).filter((row) => row.pinned || row.count > 0);
  }, [summary]);

  if (authLoading || !allowed) return <Splash />;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>Booking Sources</h1>
          <span className={styles.badge}>Owner Only</span>
        </div>
        <p className={styles.subtitle}>See where reservations come from.</p>
      </header>

      <div className={styles.periods} role="tablist" aria-label="Period">
        {BOOKING_SOURCE_PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={p === days}
            className={p === days ? `${styles.period} ${styles.periodActive}` : styles.period}
            onClick={() => setDays(p)}
          >
            {p}D
          </button>
        ))}
      </div>

      {error ? (
        <p className={styles.error}>{error}</p>
      ) : (
        <>
          <section className={styles.card}>
            <div className={styles.totalRow}>
              <div>
                <h2 className={styles.cardTitle}>Total bookings</h2>
                <p className={styles.cardSub}>Last {days} days</p>
              </div>
              <span className={styles.totalNumber}>{loading || !summary ? "–" : summary.total}</span>
            </div>
          </section>

          <section className={styles.card}>
            <h2 className={styles.breakdownTitle}>Source Breakdown</h2>
            <ul className={styles.rows}>
              {rows.map((row) => (
                <li key={row.key} className={styles.row}>
                  <div className={styles.rowHead}>
                    <span className={styles.rowLabel}>{row.label}</span>
                    <span className={styles.rowValue}>
                      {plural(row.count, "booking")} · {row.percent}%
                    </span>
                  </div>
                  <progress
                    className={styles.bar}
                    max={Math.max(summary?.total ?? 0, 1)}
                    value={row.count}
                    aria-label={`${row.label} share`}
                  />
                </li>
              ))}
            </ul>
            <footer className={styles.footer}>
              <p>Updated today</p>
              {summary && summary.untracked > 0 && (
                <p className={styles.note}>
                  {plural(summary.untracked, "booking")} made by staff or before {TRACKING_STARTED} have
                  no source and aren&apos;t counted.
                </p>
              )}
            </footer>
          </section>
        </>
      )}
    </div>
  );
}
