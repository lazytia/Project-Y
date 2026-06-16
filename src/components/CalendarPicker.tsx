"use client";

import { useState, useEffect, useCallback } from "react";
import styles from "./CalendarPicker.module.css";

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

interface Props {
  value: string;           // YYYY-MM-DD (single selected date)
  maxDate: string;
  minDate?: string;        // YYYY-MM-DD, default 2024-01-01
  singleOnly?: boolean;    // hides the mode toggle; always single mode
  onChange: (dateKey: string) => void;
  onRangeChange: (start: string, end: string) => void;
  onClose: () => void;
}

type Mode = "single" | "range";

function buildKey(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function formatShort(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-AU", {
    day: "numeric", month: "short", timeZone: "UTC",
  });
}

export default function CalendarPicker({ value, maxDate, minDate, singleOnly = false, onChange, onRangeChange, onClose }: Props) {
  const [mode, setMode] = useState<Mode>("single");
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const [rangeEnd,   setRangeEnd]   = useState<string | null>(null);
  const [hovered,    setHovered]    = useState<string | null>(null);

  const [y, m] = value.split("-").map(Number);
  const [viewYear,  setViewYear]  = useState(y);
  const [viewMonth, setViewMonth] = useState(m - 1);
  /** Year picker overlay (tap year in header → grid of selectable years). */
  const [yearPickerOpen, setYearPickerOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const handleBackdrop = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  const [maxY, maxM] = maxDate.split("-").map(Number);
  const isMaxMonth = viewYear === maxY && viewMonth === maxM - 1;
  const [minY, minM] = (minDate ?? "2024-01-01").split("-").map(Number);
  const isMinMonth = viewYear === minY && viewMonth === (minM - 1);

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

  // Year grid bounds — descending so the most recent year is at the top,
  // which feels right for a Date-of-Birth selector.
  const yearsForPicker: number[] = [];
  for (let yr = maxY; yr >= minY; yr--) yearsForPicker.push(yr);

  const firstDow    = new Date(Date.UTC(viewYear, viewMonth, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });

  function handleDay(day: number) {
    const k = buildKey(viewYear, viewMonth, day);
    if (k > maxDate) return;

    if (mode === "single") {
      onChange(k);
      onClose();
      return;
    }

    // Range mode
    if (!rangeStart || (rangeStart && rangeEnd)) {
      // Start fresh
      setRangeStart(k);
      setRangeEnd(null);
    } else {
      // Second tap
      if (k < rangeStart) {
        setRangeEnd(rangeStart);
        setRangeStart(k);
      } else if (k === rangeStart) {
        // Tap same day → single day range
        setRangeEnd(k);
      } else {
        setRangeEnd(k);
      }
    }
  }

  function confirmRange() {
    if (rangeStart && rangeEnd) {
      onRangeChange(rangeStart, rangeEnd);
      onClose();
    }
  }

  function isInRange(k: string): boolean {
    const start = rangeStart;
    const end   = rangeEnd ?? hovered;
    if (!start || !end) return false;
    const lo = start < end ? start : end;
    const hi = start < end ? end   : start;
    return k > lo && k < hi;
  }

  function isRangeStart(k: string) { return k === rangeStart; }
  function isRangeEnd(k: string)   { return rangeEnd ? k === rangeEnd : (hovered && rangeStart && k === hovered && hovered > rangeStart) ? true : false; }

  function switchMode(m: Mode) {
    setMode(m);
    setRangeStart(null);
    setRangeEnd(null);
    setHovered(null);
  }

  return (
    <div className={styles.backdrop} onClick={handleBackdrop}>
      <div className={styles.sheet}>
        <div className={styles.handle} />

        {/* Mode toggle */}
        {!singleOnly && (
          <div className={styles.modeToggle}>
            <button
              className={`${styles.modeBtn} ${mode === "single" ? styles.modeBtnActive : ""}`}
              onClick={() => switchMode("single")}
            >Single Day</button>
            <button
              className={`${styles.modeBtn} ${mode === "range" ? styles.modeBtnActive : ""}`}
              onClick={() => switchMode("range")}
            >Date Range</button>
          </div>
        )}

        {/* Range hint */}
        {mode === "range" && (
          <div className={styles.rangeHint}>
            {!rangeStart
              ? "Tap start date"
              : !rangeEnd
              ? <><span className={styles.rangeHintDate}>{formatShort(rangeStart)}</span> → tap end date</>
              : <><span className={styles.rangeHintDate}>{formatShort(rangeStart)}</span> – <span className={styles.rangeHintDate}>{formatShort(rangeEnd)}</span></>
            }
          </div>
        )}

        {/* Month nav */}
        <div className={styles.header}>
          <button className={styles.navBtn} onClick={prevMonth} disabled={isMinMonth || yearPickerOpen} aria-label="Prev month">‹</button>
          <button
            type="button"
            className={styles.monthTitleBtn}
            onClick={() => setYearPickerOpen((o) => !o)}
            aria-label="Jump to year"
            aria-expanded={yearPickerOpen}
          >
            <span className={styles.monthTitle}>{MONTH_NAMES[viewMonth]} {viewYear}</span>
            <span className={`${styles.monthTitleChev} ${yearPickerOpen ? styles.monthTitleChevOpen : ""}`} aria-hidden="true">▾</span>
          </button>
          <button className={styles.navBtn} onClick={nextMonth} disabled={isMaxMonth || yearPickerOpen} aria-label="Next month">›</button>
        </div>

        {/* Year grid overlay */}
        {yearPickerOpen && (
          <div className={styles.yearGrid} role="listbox">
            {yearsForPicker.map((yr) => (
              <button
                key={yr}
                type="button"
                role="option"
                aria-selected={yr === viewYear}
                className={`${styles.yearCell} ${yr === viewYear ? styles.yearCellActive : ""}`}
                onClick={() => {
                  setViewYear(yr);
                  setYearPickerOpen(false);
                }}
              >
                {yr}
              </button>
            ))}
          </div>
        )}

        {/* Day-of-week headers */}
        {!yearPickerOpen && (
          <div className={styles.weekRow}>
            {DAYS_OF_WEEK.map(d => <span key={d} className={styles.weekLabel}>{d}</span>)}
          </div>
        )}

        {/* Grid */}
        {!yearPickerOpen && (
        <div className={styles.grid}>
          {cells.map((day, i) => {
            if (!day) return <span key={`e-${i}`} />;
            const k = buildKey(viewYear, viewMonth, day);
            const isFuture   = k > maxDate;
            const isBeforeMin = minDate ? k < minDate : false;
            const isSingle  = mode === "single" && k === value;
            const isStart   = mode === "range" && isRangeStart(k);
            const isEnd     = mode === "range" && !!rangeEnd && isRangeEnd(k);
            const inRange   = mode === "range" && isInRange(k);
            const isToday   = k === todayKey;

            return (
              <button
                key={k}
                type="button"
                className={[
                  styles.day,
                  isSingle || isStart || isEnd ? styles.daySelected : "",
                  inRange ? styles.dayInRange : "",
                  isToday && !isSingle && !isStart && !isEnd ? styles.dayToday : "",
                  isFuture || isBeforeMin ? styles.dayDisabled : "",
                  isStart && rangeEnd ? styles.dayRangeStart : "",
                  isEnd ? styles.dayRangeEnd : "",
                ].join(" ")}
                onClick={() => handleDay(day)}
                onMouseEnter={() => { if (mode === "range" && rangeStart && !rangeEnd) setHovered(k); }}
                onMouseLeave={() => setHovered(null)}
                disabled={isFuture || isBeforeMin}
              >
                {day}
              </button>
            );
          })}
        </div>
        )}

        {/* Actions */}
        {mode === "range" && rangeStart && rangeEnd ? (
          <button className={styles.confirmBtn} onClick={confirmRange}>
            View {formatShort(rangeStart)} – {formatShort(rangeEnd)}
          </button>
        ) : (
          <button className={styles.todayShortcut} onClick={() => { onChange(todayKey); onClose(); }}>
            Go to Today
          </button>
        )}
      </div>
    </div>
  );
}
