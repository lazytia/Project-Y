"use client";

/**
 * Training Manual — placeholder until the real material exists.
 *
 * The previous version of this page shipped a hard-coded "v2.4" manual with
 * three invented sections and a signature block that never persisted. It read
 * as real content to staff, so it is gone; the owner will publish the actual
 * manual when it is written.
 */

import { useRouter } from "next/navigation";
import styles from "./page.module.css";

export default function TrainingManualPage() {
  const router = useRouter();

  return (
    <div className={styles.page}>
      <button
        type="button"
        className={styles.backBtn}
        onClick={() => router.back()}
        aria-label="Back"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      <div className={styles.titleWrap}>
        <span className={styles.titleIcon} aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
        </span>
        <h1 className={styles.pageTitle}>Training Manual</h1>
      </div>

      <div className={styles.rule} />

      <div className={styles.empty}>
        <svg
          className={styles.emptyArt}
          viewBox="0 0 160 132"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="24" y="110" width="112" height="15" rx="4" />
          <line x1="34" y1="110" x2="34" y2="125" />
          <rect x="33" y="94" width="94" height="15" rx="4" />
          <line x1="43" y1="94" x2="43" y2="109" />
          <path d="M64 94h32l-5-26H69z" />
          <line x1="66" y1="76" x2="94" y2="76" />
          <path d="M80 68V42" />
          <path d="M80 60c-1-12-8-19-19-22 1 13 8 20 19 22z" />
          <path d="M80 54c1-11 8-17 18-19-1 12-8 18-18 19z" />
        </svg>

        <p className={styles.emptyTitle}>
          No training materials
          <br />
          are available at this time.
        </p>
        <p className={styles.emptySub}>
          New guides and updates
          <br />
          will appear here when published.
        </p>
      </div>

      <div className={styles.noteBox}>
        <span className={styles.noteIcon} aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18h6" />
            <path d="M10 22h4" />
            <path d="M12 2a7 7 0 0 0-4 12.7V16h8v-1.3A7 7 0 0 0 12 2z" />
          </svg>
        </span>
        <div className={styles.noteBody}>
          <p className={styles.noteTitle}>Stay tuned</p>
          <p className={styles.noteText}>
            Helpful resources, training guides, and updates are on the way.
          </p>
        </div>
      </div>
    </div>
  );
}
