"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { notFound } from "next/navigation";
import {
  PAYSLIPS,
  fmtCurrency,
  fmtDateLong,
  fmtPeriod,
} from "../_data";
import styles from "./page.module.css";

export default function PayslipDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const slip = PAYSLIPS.find((p) => p.id === id);
  if (!slip) notFound();

  return (
    <div className={styles.page}>
      <button
        type="button"
        className={styles.backBtn}
        onClick={() => router.push("/staff/payslips")}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        <span>Back</span>
      </button>

      <h1 className={styles.title}>Payslip</h1>

      {/* Meta card (Paid + Pay Period) */}
      <section className={styles.metaCard}>
        <div className={styles.metaRow}>
          <span className={styles.metaIconWarm} aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </span>
          <div className={styles.metaText}>
            <p className={styles.metaLabel}>Paid</p>
            <p className={styles.metaValueWarm}>{fmtDateLong(slip.payDate)}</p>
          </div>
        </div>

        <div className={styles.metaDivider} />

        <div className={styles.metaRow}>
          <span className={styles.metaIconMuted} aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </span>
          <div className={styles.metaText}>
            <p className={styles.metaLabel}>Pay Period</p>
            <p className={styles.metaValue}>
              {fmtPeriod(slip.periodStart, slip.periodEnd)}
            </p>
          </div>
        </div>
      </section>

      {/* Summary card with Net Pay hero + breakdown */}
      <section className={styles.summaryCard}>
        <p className={styles.netLabel}>Net Pay</p>
        <p className={styles.netAmount}>{fmtCurrency(slip.netPay)}</p>

        <div className={styles.summaryDivider} />

        <div className={styles.summaryRow}>
          <span className={styles.summaryLabel}>Gross Pay</span>
          <span className={styles.summaryValue}>{fmtCurrency(slip.grossPay)}</span>
        </div>

        <div className={styles.summaryDivider} />

        <div className={styles.summaryRow}>
          <span className={styles.summaryLabel}>Tax</span>
          <span className={styles.summaryValue}>{fmtCurrency(slip.tax)}</span>
        </div>

        <div className={styles.summaryDivider} />

        <div className={styles.summaryRow}>
          <span className={styles.summaryLabel}>Super</span>
          <span className={styles.summaryValue}>{fmtCurrency(slip.super)}</span>
        </div>
      </section>

      <div className={styles.infoBox}>
        <span className={styles.infoIcon} aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </span>
        <p className={styles.infoBody}>
          This is a summary of your payslip.
        </p>
      </div>
    </div>
  );
}
