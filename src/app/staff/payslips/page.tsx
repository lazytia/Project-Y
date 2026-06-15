"use client";

import Link from "next/link";
import {
  PAYSLIPS,
  NEXT_PAY_DATE_ISO,
  PAY_FREQUENCY,
  fmtCurrency,
  fmtDateLong,
  fmtPeriod,
} from "./_data";
import styles from "./page.module.css";

export default function PayslipsPage() {
  const latest = PAYSLIPS[0];
  const previous = PAYSLIPS.slice(1);

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Payslips</h1>

      {/* Next Pay Date */}
      <section className={styles.nextPayCard}>
        <div className={styles.payIcon} aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </div>
        <div className={styles.nextPayBody}>
          <p className={styles.nextPayLabel}>Next Pay Date</p>
          <p className={styles.nextPayDate}>{fmtDateLong(NEXT_PAY_DATE_ISO)}</p>
          <p className={styles.nextPaySub}>{PAY_FREQUENCY}</p>
        </div>
      </section>

      {/* Latest Payslip */}
      <h2 className={styles.sectionTitle}>Latest Payslip</h2>
      <section className={styles.latestCard}>
        <div className={styles.latestHeader}>
          <div className={styles.latestIcon} aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
          </div>
          <div className={styles.latestHeading}>
            <p className={styles.latestMeta}>Pay Period</p>
            <p className={styles.latestPeriod}>
              {fmtPeriod(latest.periodStart, latest.periodEnd)}
            </p>
          </div>
        </div>

        <div className={styles.latestDivider} />

        <div className={styles.latestSection}>
          <p className={styles.latestMeta}>Net Pay</p>
          <p className={styles.latestAmount}>{fmtCurrency(latest.netPay)}</p>
        </div>

        <div className={styles.latestDivider} />

        <div className={styles.latestSection}>
          <p className={styles.latestMeta}>Paid</p>
          <p className={styles.latestPaidDate}>{fmtDateLong(latest.payDate)}</p>
        </div>

        <Link href={`/staff/payslips/${latest.id}`} className={styles.viewBtn}>
          <span>View Payslip</span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </Link>
      </section>

      {/* Previous Payslips */}
      <h2 className={styles.sectionTitle}>Previous Payslips</h2>
      <ul className={styles.prevList}>
        {previous.map((p) => (
          <li key={p.id}>
            <Link href={`/staff/payslips/${p.id}`} className={styles.prevRow}>
              <span className={styles.prevIcon} aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </span>
              <span className={styles.prevDate}>{fmtDateLong(p.payDate).replace(/^[A-Za-z]+, /, "")}</span>
              <span className={styles.prevAmount}>{fmtCurrency(p.netPay)}</span>
              <span className={styles.prevChevron} aria-hidden="true">›</span>
            </Link>
          </li>
        ))}
      </ul>

      <div className={styles.infoBox}>
        <span className={styles.infoIcon} aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </span>
        <p className={styles.infoBody}>
          Payslips are available for the last 12 months.
        </p>
      </div>
    </div>
  );
}
