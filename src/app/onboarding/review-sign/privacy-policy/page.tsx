"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import styles from "../staff-handbook/page.module.css";

const POLICY_VERSION = "1.0";
const POLICY_UPDATED = "June 2026";

export default function PrivacyPolicyPage() {
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
            privacySignedAt: serverTimestamp(),
            privacyVersion: POLICY_VERSION,
            privacyReadAcknowledged: true,
            privacyAgreed: true,
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
            <span className={styles.coverTitleSub}>PRIVACY POLICY</span>
          </h1>
          <div className={styles.coverDivider} />
          <p className={styles.coverParagraph}>
            This policy explains how YURICA collects, uses, stores, and protects
            personal information about its employees and contractors.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionH}>1. INFORMATION WE COLLECT</h2>
          <ul className={styles.bulletList}>
            <li>Identification (full name, date of birth, photo ID).</li>
            <li>Contact details (email, phone, address).</li>
            <li>Tax File Number and superannuation details.</li>
            <li>Bank details for payroll.</li>
            <li>
              Work eligibility documents (passport, visa, RSA, qualifications).
            </li>
            <li>Roster, attendance, and performance records.</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionH}>2. HOW WE USE YOUR INFORMATION</h2>
          <ul className={styles.bulletList}>
            <li>Employment administration, rostering, and payroll.</li>
            <li>Complying with tax, superannuation, and immigration laws.</li>
            <li>Communicating with you about your shifts and employment.</li>
            <li>Workplace safety and operational record-keeping.</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionH}>3. STORAGE &amp; SECURITY</h2>
          <p className={styles.paragraph}>
            Information is stored in Firebase services (Authentication,
            Firestore, Storage) hosted on Google Cloud infrastructure.
          </p>
          <p className={styles.paragraph}>
            Access is restricted to authorised managers via account-based
            permissions and audit logs.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionH}>4. DISCLOSURE TO THIRD PARTIES</h2>
          <p className={styles.paragraph}>
            We only share your information with third parties where required by
            law or where necessary to operate the business (e.g. the ATO for
            tax, your nominated super fund, payroll processors).
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionH}>5. YOUR RIGHTS</h2>
          <ul className={styles.bulletList}>
            <li>You may request access to your stored information at any time.</li>
            <li>You may request correction of incorrect information.</li>
            <li>
              You may withdraw consent for non-essential uses by contacting
              management.
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionH}>6. RETENTION</h2>
          <p className={styles.paragraph}>
            Employee records are retained for the duration of employment and for
            up to 7 years after termination, in line with Australian record-keeping
            obligations.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.ackTitle}>EMPLOYEE ACKNOWLEDGEMENT</h2>
          <div className={styles.ackUnderline} />
          <p className={styles.ackBody}>
            Please acknowledge that you have read and understood YURICA&apos;s
            Privacy Policy.
          </p>

          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={readChecked}
              onChange={(e) => setReadChecked(e.target.checked)}
            />
            <span className={styles.checkboxLabel}>
              I have read and understood the YURICA Privacy Policy.
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
              I consent to YURICA collecting and processing my personal
              information as described above.
            </span>
          </label>

          <div className={styles.metaRow}>
            <div className={styles.metaItem}>
              <span>Version</span>
              <span>{POLICY_VERSION}</span>
            </div>
            <div className={styles.metaItem}>
              <span>Last Updated</span>
              <span>{POLICY_UPDATED}</span>
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
