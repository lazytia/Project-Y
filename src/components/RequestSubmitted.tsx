"use client";

import { useLang } from "@/components/LanguageProvider";
import styles from "./RequestSubmitted.module.css";

/** One fact about the request — "Duration / 5 days", "Mon – Fri / All Day". */
export type SubmittedRow = { label: string; value: string };

/** A titled block of rows, rendered as a divided table. */
export type SubmittedSection = { title: string; rows: readonly SubmittedRow[] };

/**
 * The screen a request lands on once it has been filed.
 *
 * Shared by holiday requests and availability changes because they are the
 * same screen: both say the thing was received, repeat back what was asked
 * for so it can be checked at a glance, and end in one way out. Keeping it in
 * one component is what stops the two drifting into near-copies of each other.
 *
 * It replaces the page it is shown from rather than opening over it. A modal
 * would leave the submitted form sitting behind it, which invites a second
 * submission of a request that has already gone in; and the summary is worth
 * more room than a dialog gives it.
 *
 * `onDone` is a parameter rather than a route because the caller owns where
 * its reader came from. Both callers currently send them back to Requests.
 */
export default function RequestSubmitted({
  highlightLabel,
  highlightValues,
  sections,
  reason,
  onDone,
}: {
  /** Small caps heading on the headline card — "Holiday dates". */
  highlightLabel: string;
  /** The dates themselves; a range reads as two lines, one date as one. */
  highlightValues: readonly string[];
  sections: readonly SubmittedSection[];
  /** Shown as its own card. Omitted when the reader left it blank. */
  reason?: SubmittedRow | null;
  onDone: () => void;
}) {
  const { t } = useLang();

  return (
    <div className={styles.screen}>
      <div className={styles.iconWrap} aria-hidden="true">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="8 12 11 15 16 9" />
        </svg>
      </div>

      <h1 className={styles.title}>{t("req.submitted.title")}</h1>
      <p className={styles.sub}>{t("req.submitted.sub")}</p>

      <div className={styles.highlightCard}>
        <span className={styles.highlightIcon} aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </span>
        <div className={styles.highlightBody}>
          <p className={styles.highlightLabel}>{highlightLabel}</p>
          {highlightValues.map((v, i) => (
            <p key={i} className={styles.highlightValue}>{v}</p>
          ))}
          <span className={styles.statusBadge}>{t("req.submitted.pending")}</span>
        </div>
      </div>

      {sections.map((section) => (
        <div key={section.title} className={styles.card}>
          <p className={styles.cardTitle}>{section.title}</p>
          {section.rows.map((row) => (
            <div key={row.label} className={styles.row}>
              <span className={styles.rowLabel}>{row.label}</span>
              <span className={styles.rowValue}>{row.value}</span>
            </div>
          ))}
        </div>
      ))}

      {reason && (
        <div className={styles.reasonCard}>
          <span className={styles.reasonLabel}>{reason.label}</span>
          <span className={styles.reasonValue}>{reason.value}</span>
        </div>
      )}

      <button type="button" className={styles.doneBtn} onClick={onDone}>
        {t("req.submitted.done")}
      </button>
    </div>
  );
}
