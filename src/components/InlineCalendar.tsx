"use client";

import { useMemo, useState } from "react";
import styles from "./InlineCalendar.module.css";

/**
 * A month calendar that opens in the flow of the page, under the field that
 * asks for the date, and picks one day.
 *
 * Not CalendarPicker: that one is a bottom sheet over a dimmed page, built for
 * the dashboards' date and range pickers and with a "Go to Today" shortcut that
 * would pick a day this one has to refuse. This is for a form that offers a
 * window of acceptable dates — nothing before `minDate`, nothing after
 * `maxDate` — and wants the rest of the form to stay in view while it is open.
 *
 * Dates are YYYY-MM-DD keys throughout and are read as calendar days, never as
 * instants, so a device in another time zone cannot shift a day.
 */

type Props = {
  /** The chosen day, or "" for none yet. */
  value: string;
  /** Earliest day that can be picked. */
  minDate: string;
  /** Latest day that can be picked. */
  maxDate: string;
  /** Intl locale for the month title and weekday labels. */
  locale?: string;
  onChange: (dateKey: string) => void;
};

function buildKey(y: number, monthIndex: number, d: number): string {
  return `${y}-${String(monthIndex + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** A day as a UTC-noon Date, which formats the same whatever the device's zone. */
function atNoonUTC(y: number, monthIndex: number, d: number): Date {
  return new Date(Date.UTC(y, monthIndex, d, 12));
}

export default function InlineCalendar({
  value,
  minDate,
  maxDate,
  locale = "en-AU",
  onChange,
}: Props) {
  // Open on the chosen day's month, or the first month that has a pickable day.
  const [anchorY, anchorM] = (value || minDate).split("-").map(Number);
  const [viewYear, setViewYear] = useState(anchorY);
  const [viewMonth, setViewMonth] = useState(anchorM - 1);

  const [minY, minM] = minDate.split("-").map(Number);
  const [maxY, maxM] = maxDate.split("-").map(Number);
  const atFirstMonth = viewYear === minY && viewMonth === minM - 1;
  const atLastMonth = viewYear === maxY && viewMonth === maxM - 1;

  function step(delta: -1 | 1) {
    const next = atNoonUTC(viewYear, viewMonth + delta, 1);
    setViewYear(next.getUTCFullYear());
    setViewMonth(next.getUTCMonth());
  }

  // Sunday first, to match the sheet picker used elsewhere in the app.
  const weekdayLabels = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
    // 2026-11-01 is a Sunday.
    return Array.from({ length: 7 }, (_, i) => fmt.format(atNoonUTC(2026, 10, 1 + i)));
  }, [locale]);

  const monthTitle = atNoonUTC(viewYear, viewMonth, 1).toLocaleDateString(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const firstWeekday = atNoonUTC(viewYear, viewMonth, 1).getUTCDay();
  const daysInMonth = atNoonUTC(viewYear, viewMonth + 1, 0).getUTCDate();
  const cells: (number | null)[] = [
    ...Array<null>(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <p className={styles.monthTitle}>{monthTitle}</p>
        <button
          type="button"
          className={styles.navBtn}
          onClick={() => step(-1)}
          disabled={atFirstMonth}
          aria-label="Previous month"
        >
          ‹
        </button>
        <button
          type="button"
          className={styles.navBtn}
          onClick={() => step(1)}
          disabled={atLastMonth}
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      <div className={styles.weekRow} aria-hidden="true">
        {weekdayLabels.map((label, i) => (
          <span key={i} className={styles.weekLabel}>
            {label.slice(0, 2)}
          </span>
        ))}
      </div>

      <div className={styles.grid}>
        {cells.map((day, i) => {
          if (day === null) return <span key={`blank-${i}`} />;
          const key = buildKey(viewYear, viewMonth, day);
          const outOfRange = key < minDate || key > maxDate;
          const selected = key === value;
          return (
            <button
              key={key}
              type="button"
              className={`${styles.day} ${selected ? styles.daySelected : ""}`}
              disabled={outOfRange}
              aria-pressed={selected}
              aria-label={atNoonUTC(viewYear, viewMonth, day).toLocaleDateString(locale, {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
                timeZone: "UTC",
              })}
              onClick={() => onChange(key)}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
