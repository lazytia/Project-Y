"use client";

import { useEffect, useState } from "react";
import {
  activeHolidayClosures,
  fmtClosurePeriod,
  type ClosurePeriod,
} from "@/lib/holiday-closures";
import styles from "./HolidayClosuresBanner.module.css";

/**
 * "HOLIDAY CLOSURES 25 – 28 Dec | 1 – 3 Jan" at the top of a dashboard, for
 * the weeks set in lib/holiday-closures and not a day longer.
 *
 * Decided after mount, from the Sydney date: the dashboards are rendered on
 * the server as well, and a banner that appeared or vanished between the two
 * renders would jump the page. Re-checked when the app comes back to the
 * front, so a phone left open over the last night still drops it.
 */
export default function HolidayClosuresBanner({ label = "HOLIDAY CLOSURES" }: { label?: string }) {
  const [periods, setPeriods] = useState<ClosurePeriod[] | null>(null);

  useEffect(() => {
    const check = () => setPeriods(activeHolidayClosures());
    check();
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  if (!periods) return null;

  return (
    <section className={styles.banner} aria-label={label}>
      <span className={styles.icon} aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4.5" width="18" height="16.5" rx="2" />
          <line x1="16" y1="2.5" x2="16" y2="6.5" />
          <line x1="8" y1="2.5" x2="8" y2="6.5" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      </span>
      <span className={styles.divider} aria-hidden="true" />
      <div className={styles.text}>
        <p className={styles.label}>{label}</p>
        <p className={styles.dates}>
          {periods.map((p, i) => (
            <span key={p.from} className={styles.period}>
              {i > 0 && <span className={styles.sep} aria-hidden="true">|</span>}
              {fmtClosurePeriod(p)}
            </span>
          ))}
        </p>
      </div>
    </section>
  );
}
