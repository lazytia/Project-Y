"use client";

import type { RateChange, RateSet } from "@/lib/staff-rates";
import type { RateHistoryRow } from "@/lib/rate-history";
import styles from "./page.module.css";

/**
 * The Pay Details block of Employee Details: what the employee is paid now,
 * any change scheduled for later, and what they were paid before.
 *
 * Rates are changed by scheduling, never typed over — a pay week can straddle
 * the day a raise starts, and each shift is paid at the rate of the day it was
 * worked (see lib/staff-rates). This drives the pay on /payroll/timesheets.
 */
export default function PayDetails({
  weekdayRate,
  saturdayRate,
  upcoming,
  history,
  cancelling,
  onSchedule,
  onEdit,
  onCancel,
}: {
  weekdayRate: number | null;
  saturdayRate: number | null;
  /** Changes still to start, each with the rates it replaces. */
  upcoming: { change: RateChange; before: RateSet }[];
  history: RateHistoryRow[];
  /** Date of the change being cancelled, while it is. */
  cancelling: string | null;
  onSchedule: () => void;
  onEdit: (change: RateChange) => void;
  onCancel: (change: RateChange) => void;
}) {
  return (
    <section className={styles.payDetails}>
      <h2 className={styles.payTitle}>Pay Details</h2>
      <div className={styles.payCurrent}>
        <p className={styles.payCurrentLabel}>CURRENT RATE</p>
        <div className={styles.payCurrentGrid}>
          <CurrentRate label="Weekdays" value={weekdayRate} />
          <span className={styles.payCurrentDivider} aria-hidden="true" />
          <CurrentRate label="Saturday" value={saturdayRate} />
        </div>
      </div>

      {upcoming.map(({ change, before }) => (
        <ScheduledRateChange
          key={change.effectiveFrom}
          change={change}
          before={before}
          cancelling={cancelling === change.effectiveFrom}
          onEdit={() => onEdit(change)}
          onCancel={() => onCancel(change)}
        />
      ))}

      <button type="button" className={styles.scheduleRateBtn} onClick={onSchedule}>
        + Schedule Rate Change
      </button>

      {history.length > 0 && (
        <>
          <h3 className={styles.historyTitle}>Rate History</h3>
          <ul className={styles.historyList}>
            {history.map((row) => (
              <RateHistoryItem key={`${row.kind}-${row.fromISO ?? "start"}`} row={row} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

/** "$32", or "$32.50" when there are cents — the short form the Pay Details
 *  card uses beside an arrow or inside a sentence. */
function fmtRateShort(n: number | null): string {
  if (n == null) return "—";
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** "14 Nov 2026". */
function fmtIso(iso: string): string {
  return fmtDate(isoToDate(iso));
}

/** "27 Oct – 9 Nov 2026", or both years when the span crosses one. */
function fmtIsoRange(fromISO: string, toISO: string): string {
  const from = isoToDate(fromISO);
  const to = isoToDate(toISO);
  const fromText =
    from.getFullYear() === to.getFullYear()
      ? from.toLocaleDateString("en-AU", { day: "numeric", month: "short" })
      : fmtDate(from);
  return `${fromText} – ${fmtDate(to)}`;
}

/** One half of CURRENT RATE: a label over a dollar figure. */
function CurrentRate({ label, value }: { label: string; value: number | null }) {
  return (
    <div className={styles.payCurrentCell}>
      <p className={styles.payCurrentCellLabel}>{label}</p>
      <p className={styles.payCurrentValue}>
        {value != null ? `$${value.toFixed(2)}` : "—"}
        {value != null && <span className={styles.payCurrentUnit}> /hr</span>}
      </p>
    </div>
  );
}

/**
 * An upcoming change, old rate to new. Saturday is shown as what a Saturday
 * actually pays, which is the weekday rate for anyone without a Saturday one.
 */
function ScheduledRateChange({
  change,
  before,
  cancelling,
  onEdit,
  onCancel,
}: {
  change: RateChange;
  before: RateSet;
  cancelling: boolean;
  onEdit: () => void;
  onCancel: () => void;
}) {
  const satBefore = before.saturday ?? before.weekday;
  const satAfter = change.saturday ?? change.weekday;
  const showSaturday = before.saturday != null || change.saturday != null;
  return (
    <div className={styles.scheduledCard}>
      <div className={styles.scheduledHead}>
        <span className={styles.scheduledPill}>Scheduled</span>
        <span className={styles.scheduledDate}>{fmtIso(change.effectiveFrom)}</span>
      </div>
      <div className={styles.scheduledRow}>
        <span className={styles.scheduledLabel}>Weekdays</span>
        <span className={styles.scheduledValue}>
          {fmtRateShort(before.weekday)} → {fmtRateShort(change.weekday)} /hr
        </span>
      </div>
      {showSaturday && (
        <div className={styles.scheduledRow}>
          <span className={styles.scheduledLabel}>Saturday</span>
          <span className={styles.scheduledValue}>
            {fmtRateShort(satBefore)} → {fmtRateShort(satAfter)} /hr
          </span>
        </div>
      )}
      <div className={styles.scheduledActions}>
        <button type="button" className={styles.scheduledAction} onClick={onEdit} disabled={cancelling}>
          Edit
        </button>
        <span className={styles.scheduledActionDivider} aria-hidden="true" />
        <button type="button" className={styles.scheduledAction} onClick={onCancel} disabled={cancelling}>
          {cancelling ? "Cancelling…" : "Cancel"}
        </button>
      </div>
    </div>
  );
}

/** One row of Rate History: when, what kind, and what it paid. */
function RateHistoryItem({ row }: { row: RateHistoryRow }) {
  const when =
    row.fromISO && row.toISO
      ? fmtIsoRange(row.fromISO, row.toISO)
      : row.fromISO
        ? fmtIso(row.fromISO)
        : row.kind === "standard"
          ? "After training"
          : "—";
  const paid =
    row.kind === "training"
      ? `${fmtRateShort(row.weekday)} /hr`
      : row.saturday != null
        ? `Weekdays ${fmtRateShort(row.weekday)} · Saturday ${fmtRateShort(row.saturday)}`
        : `Weekdays ${fmtRateShort(row.weekday)}`;
  return (
    <li className={styles.historyItem}>
      <div className={styles.historyHead}>
        <span className={styles.historyDate}>{when}</span>
        <span className={styles.historyPill}>{row.kind === "training" ? "Training" : "Standard rate"}</span>
      </div>
      <p className={styles.historyRates}>{paid}</p>
    </li>
  );
}
