"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { isOwnerOrChef } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

/* ──────────────────────────────────────────────────────────────────────
 * New Cash Payment — step 1: pick the recipient type. Routes to the
 * matching detail form (trial-shift candidate or active employee).
 * ──────────────────────────────────────────────────────────────────── */

export default function NewCashPaymentPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwnerOrChef(user);

  useEffect(() => {
    if (authLoading) return;
    if (!allowed) router.replace(ROUTES.home);
  }, [authLoading, allowed, router]);

  if (authLoading) return <Splash />;
  if (!allowed) return null;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => router.push("/people/cash-payments")}
          aria-label="Back"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className={styles.title}>New Cash Payment</h1>
        <span />
      </header>

      <div className={styles.body}>
        <section className={styles.heading}>
          <h2 className={styles.bigTitle}>Who is this payment for?</h2>
          <p className={styles.bigSub}>
            Select the type of person to record the cash payment.
          </p>
        </section>

        <button
          type="button"
          className={`${styles.choice} ${styles.choicePrimary}`}
          onClick={() => router.push("/people/cash-payments/new/trial-shift")}
        >
          <span className={styles.choiceIcon} aria-hidden="true">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
            </svg>
          </span>
          <span className={styles.choiceLabel}>Trial Shift (Candidate)</span>
          <span className={styles.choiceSub}>
            Cash payment for a trial shift. Record hours, outcome, ID and
            get signature.
          </span>
          <span className={styles.choiceChev} aria-hidden="true">›</span>
        </button>

        <button
          type="button"
          className={styles.choice}
          onClick={() => router.push("/people/cash-payments/new/active-employee")}
        >
          <span className={styles.choiceIcon} aria-hidden="true">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
            </svg>
          </span>
          <span className={styles.choiceLabel}>Active Employee</span>
          <span className={styles.choiceSub}>
            Cash payment for an active employee (adjustment, advance,
            reimbursement, etc.)
          </span>
          <span className={styles.choiceChev} aria-hidden="true">›</span>
        </button>

        <section className={styles.infoBox}>
          <span className={styles.infoIcon} aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </span>
          <div className={styles.infoBody}>
            <p className={styles.infoTitle}>All payments are recorded securely.</p>
            <p className={styles.infoSub}>
              Records include amount, reason, and employee signature.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
