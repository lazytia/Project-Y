"use client";

import { useState, useEffect, useCallback } from "react";
import styles from "./CalendarPicker.module.css";

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

interface Props {
  value: string;        // YYYY-MM-DD
  maxDate: string;      // YYYY-MM-DD — cannot select beyond this
  onChange: (dateKey: string) => void;
  onClose: () => void;
}

function dateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export default function CalendarPicker({ value, maxDate, onChange, onClose }: Props) {
  const [y, m] = value.split("-").map(Number);
  const [viewYear, setViewYear] = useState(y);
  const [viewMonth, setViewMonth] = useState(m - 1); // 0-indexed

  // Close on backdrop click
  const handleBackdrop = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  // Prevent body scroll while open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const [maxY, maxM] = maxDate.split("-").map(Number);
  const isMaxMonth = viewYear === maxY && viewMonth === maxM - 1;
  const isMinMonth = viewYear === 2024 && viewMonth === 0; // don't go earlier than Jan 2024

  function prevMonth() {
    if (isMinMonth) return;
    if (viewMonth === 0) { setViewYear(v => v - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (isMaxMonth) return;
    if (viewMonth === 11) { setViewYear(v => v + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  }

  // Build calendar grid
  const firstDow = new Date(Date.UTC(viewYear, viewMonth, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();

  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // pad to full weeks
  while (cells.length % 7 !== 0) cells.push(null);

  const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });

  function handleDay(day: number) {
    const k = dateKey(viewYear, viewMonth, day);
    if (k > maxDate) return;
    onChange(k);
    onClose();
  }

  return (
    <div className={styles.backdrop} onClick={handleBackdrop}>
      <div className={styles.sheet}>
        {/* Handle bar */}
        <div className={styles.handle} />

        {/* Month navigation */}
        <div className={styles.header}>
          <button
            className={styles.navBtn}
            onClick={prevMonth}
            disabled={isMinMonth}
            aria-label="Previous month"
          >‹</button>
          <span className={styles.monthTitle}>
            {MONTH_NAMES[viewMonth]} {viewYear}
          </span>
          <button
            className={styles.navBtn}
            onClick={nextMonth}
            disabled={isMaxMonth}
            aria-label="Next month"
          >›</button>
        </div>

        {/* Day of week headers */}
        <div className={styles.weekRow}>
          {DAYS_OF_WEEK.map(d => (
            <span key={d} className={styles.weekLabel}>{d}</span>
          ))}
        </div>

        {/* Day grid */}
        <div className={styles.grid}>
          {cells.map((day, i) => {
            if (!day) return <span key={`empty-${i}`} />;
            const k = dateKey(viewYear, viewMonth, day);
            const isFuture = k > maxDate;
            const isSelected = k === value;
            const isToday = k === todayKey;
            return (
              <button
                key={k}
                type="button"
                className={[
                  styles.day,
                  isSelected ? styles.daySelected : "",
                  isToday && !isSelected ? styles.dayToday : "",
                  isFuture ? styles.dayDisabled : "",
                ].join(" ")}
                onClick={() => handleDay(day)}
                disabled={isFuture}
              >
                {day}
              </button>
            );
          })}
        </div>

        {/* Today shortcut */}
        <button className={styles.todayShortcut} onClick={() => { onChange(todayKey); onClose(); }}>
          Go to Today
        </button>
      </div>
    </div>
  );
}
