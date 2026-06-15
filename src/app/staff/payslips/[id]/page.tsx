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

      {/* Meta card */}
      <section className={styles.metaCard}>
        <div className={styles.metaRow}>
          <p className={styles.metaLabel}>Pay Date</p>
          <p className={styles.metaValue}>{fmtDateLong(slip.payDate)}</p>
        </div>
        <div className={styles.metaDivider} />
        <div className={styles.metaRow}>
          <p className={styles.metaLabel}>Pay Period</p>
          <p className={styles.metaValue}>
            {fmtPeriod(slip.periodStart, slip.periodEnd)}
          </p>
        </div>
      </section>

      {/* Net Pay hero */}
      <section className={styles.netCard}>
        <p className={styles.netLabel}>Net Pay</p>
        <p className={styles.netAmount}>{fmtCurrency(slip.netPay)}</p>
      </section>

      <h2 className={styles.sectionTitle}>Payment Summary</h2>
      <section className={styles.summaryCard}>
        <div className={styles.summaryRow}>
          <p className={styles.summaryLabel}>Gross Pay</p>
          <p className={styles.summaryValue}>{fmtCurrency(slip.grossPay)}</p>
        </div>
        <div className={styles.summaryDivider} />
        <div className={styles.summaryRow}>
          <p className={styles.summaryLabel}>Tax</p>
          <p className={styles.summaryValue}>{fmtCurrency(slip.tax)}</p>
        </div>
        <div className={styles.summaryDivider} />
        <div className={styles.summaryRow}>
          <p className={styles.summaryLabel}>Super</p>
          <p className={styles.summaryValue}>{fmtCurrency(slip.super)}</p>
        </div>
        <div className={styles.summaryDivider} />
        <div className={styles.summaryRow}>
          <p className={styles.summaryLabelStrong}>Net Pay</p>
          <p className={styles.summaryValueStrong}>{fmtCurrency(slip.netPay)}</p>
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
          If you have any questions, please contact your manager.
        </p>
      </div>
    </div>
  );
}
