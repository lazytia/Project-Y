"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import styles from "../staff-handbook/page.module.css";

const AGREEMENT_VERSION = "1.0";
const AGREEMENT_UPDATED = "June 2026";

export default function EmployeeAgreementPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [readChecked, setReadChecked] = useState(false);
  const [agreeChecked, setAgreeChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = readChecked && agreeChecked && !submitting;

  async function handleAgree() {
    if (!user || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await setDoc(
        doc(getDb(), "staff_onboarding", user.uid),
        {
          reviewSign: {
            agreementSignedAt: serverTimestamp(),
            agreementVersion: AGREEMENT_VERSION,
            agreementReadAcknowledged: true,
            agreementAgreed: true,
          },
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      router.push("/onboarding/review-sign");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.brand}>YURICA</header>

      <article className={styles.doc}>
        <section className={styles.coverSection}>
          <h1 className={styles.coverTitle}>
            YURICA<br />
            <span className={styles.coverTitleSub}>EMPLOYEE AGREEMENT</span>
          </h1>
          <div className={styles.coverDivider} />
          <p className={styles.coverParagraph}>
            This document sets out the key terms of your employment with YURICA.
            It should be read alongside the YURICA Staff Handbook.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionH}>1. POSITION &amp; DUTIES</h2>
          <p className={styles.paragraph}>
            You are engaged in the position offered to you at the time of
            hiring. You agree to perform your duties with due care, skill, and
            diligence, and to follow lawful and reasonable directions from
            management.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionH}>2. HOURS OF WORK</h2>
          <p className={styles.paragraph}>
            Hours of work will be communicated through the Project Y roster.
            Shift times may vary based on operational needs.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionH}>3. PAY &amp; SUPERANNUATION</h2>
          <p className={styles.paragraph}>
            You will be paid in accordance with the applicable Modern Award or
            agreed contract rate.
          </p>
          <p className={styles.paragraph}>
            Payment is processed weekly to your nominated bank account.
            Superannuation contributions are made to your nominated fund at the
            current statutory rate.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionH}>4. PROBATION</h2>
          <p className={styles.paragraph}>
            Your employment is subject to a probation period of three (3)
            months, during which either party may end the employment with one
            week&apos;s notice.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionH}>5. POLICIES</h2>
          <p className={styles.paragraph}>
            You agree to comply with the YURICA Staff Handbook and all related
            workplace policies, as amended from time to time.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionH}>6. TERMINATION</h2>
          <p className={styles.paragraph}>
            After the probation period, either party may terminate this
            agreement by giving the notice period required under the applicable
            Modern Award.
          </p>
          <p className={styles.paragraph}>
            YURICA reserves the right to terminate employment without notice in
            cases of serious misconduct, as defined in the Fair Work
            Regulations.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionH}>7. CONFIDENTIALITY &amp; PROPERTY</h2>
          <p className={styles.paragraph}>
            You agree to keep YURICA&apos;s confidential information private and
            to return all company property on termination of employment.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.ackTitle}>EMPLOYEE ACKNOWLEDGEMENT</h2>
          <div className={styles.ackUnderline} />
          <p className={styles.ackBody}>
            Please acknowledge that you have read, understood, and agree to the
            terms of the YURICA Employee Agreement.
          </p>

          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={readChecked}
              onChange={(e) => setReadChecked(e.target.checked)}
            />
            <span className={styles.checkboxLabel}>
              I have read and understood the YURICA Employee Agreement.
            </span>
          </label>

          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={agreeChecked}
              onChange={(e) => setAgreeChecked(e.target.checked)}
            />
            <span className={styles.checkboxLabel}>
              I accept the terms of employment set out above.
            </span>
          </label>

          <div className={styles.metaRow}>
            <div className={styles.metaItem}>
              <span>Version</span>
              <span>{AGREEMENT_VERSION}</span>
            </div>
            <div className={styles.metaItem}>
              <span>Last Updated</span>
              <span>{AGREEMENT_UPDATED}</span>
            </div>
          </div>

          {error && <p className={styles.error}>{error}</p>}

          <button
            type="button"
            className={styles.primaryBtn}
            onClick={handleAgree}
            disabled={!canSubmit}
          >
            {submitting ? "…" : "AGREE & CONTINUE"}
          </button>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => router.push("/onboarding/review-sign")}
          >
            BACK
          </button>
        </section>
      </article>
    </div>
  );
}
