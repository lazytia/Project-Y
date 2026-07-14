"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./MonthPicker.module.css";

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

type Props = {
  value: string;
  maxMonth: string;
  minMonth?: string;
  onChange: (monthISO: string) => void;
  onClose: () => void;
};

function monthKey(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, "0")}`;
}

export default function MonthPicker({
  value,
  maxMonth,
  minMonth = "2024-01",
  onChange,
  onClose,
}: Props) {
  const [y] = value.split("-").map(Number);
  const [viewYear, setViewYear] = useState(y);
  const [maxY] = maxMonth.split("-").map(Number);
  const [minY] = minMonth.split("-").map(Number);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const handleBackdrop = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  const isMinYear = viewYear <= minY;
  const isMaxYear = viewYear >= maxY;

  function prevYear() {
    if (isMinYear) return;
    setViewYear((yr) => yr - 1);
  }

  function nextYear() {
    if (isMaxYear) return;
    setViewYear((yr) => yr + 1);
  }

  function isDisabled(monthIdx: number): boolean {
    const mk = monthKey(viewYear, monthIdx + 1);
    return mk < minMonth || mk > maxMonth;
  }

  function handleMonth(monthIdx: number) {
    const mk = monthKey(viewYear, monthIdx + 1);
    if (isDisabled(monthIdx)) return;
    onChange(mk);
    onClose();
  }

  return (
    <div className={styles.backdrop} onClick={handleBackdrop}>
      <div className={styles.sheet}>
        <div className={styles.handle} />

        <div className={styles.header}>
          <button
            type="button"
            className={styles.navBtn}
            onClick={prevYear}
            disabled={isMinYear}
            aria-label="Previous year"
          >
            ‹
          </button>
          <span className={styles.yearTitle}>{viewYear}</span>
          <button
            type="button"
            className={styles.navBtn}
            onClick={nextYear}
            disabled={isMaxYear}
            aria-label="Next year"
          >
            ›
          </button>
        </div>

        <div className={styles.grid}>
          {MONTH_NAMES.map((label, idx) => {
            const mk = monthKey(viewYear, idx + 1);
            const selected = mk === value;
            const disabled = isDisabled(idx);
            return (
              <button
                key={label}
                type="button"
                className={[
                  styles.monthBtn,
                  selected ? styles.monthBtnSelected : "",
                  disabled ? styles.monthBtnDisabled : "",
                ].join(" ")}
                onClick={() => handleMonth(idx)}
                disabled={disabled}
                aria-pressed={selected}
              >
                {label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className={styles.currentShortcut}
          onClick={() => {
            onChange(maxMonth);
            onClose();
          }}
        >
          Go to This Month
        </button>
      </div>
    </div>
  );
}
