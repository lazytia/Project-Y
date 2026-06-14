"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { ROUTES } from "@/lib/routes";
import styles from "./page.module.css";

const STEPS = [
  { num: 1, label: "Personal\nInformation" },
  { num: 2, label: "TFN\nDeclaration" },
  { num: 3, label: "Bank & Super\nDetails" },
  { num: 4, label: "Documents" },
  { num: 5, label: "Policies" },
  { num: 6, label: "Review &\nSign" },
  { num: 7, label: "Complete" },
];

const CURRENT_STEP = 6;
const TOTAL_STEPS = 7;
const PERCENT = Math.round(((CURRENT_STEP - 1) / TOTAL_STEPS) * 100);

export default function ReviewSignPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [submitting, setSubmitting] = useState(false);

  // Final step of onboarding: mark the staff doc complete and send them to
  // their working homepage (reservations). Failing the write is non-fatal —
  // we still navigate so they aren't stuck on this screen.
  async function handleFinish() {
    if (!user || submitting) return;
    setSubmitting(true);
    try {
      await setDoc(
        doc(getDb(), "staff_onboarding", user.uid),
        {
          completedStep: TOTAL_STEPS,
          step: TOTAL_STEPS,
          status: "complete",
          completedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    } catch {
      /* best-effort */
    }
    router.replace(ROUTES.reservations);
  }

  const checkSvg = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <button
          type="button"
          className={styles.backBtn}
          onClick={() => router.push("/onboarding/policies")}
          aria-label="Back to policies"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <p className={styles.stepLabel}>Step {CURRENT_STEP} of {TOTAL_STEPS}</p>
        <h1 className={styles.title}>Review &amp; Sign</h1>
      </div>

      {/* Step Indicators */}
      <div className={styles.stepsContainer}>
        {STEPS.map((step, idx) => (
          <div key={step.num} className={styles.stepItem}>
            {idx > 0 && <div className={styles.connector} />}
            <div className={styles.stepCircleWrap}>
              <div
                className={
                  step.num < CURRENT_STEP
                    ? `${styles.stepCircle} ${styles.stepCircleCompleted}`
                    : step.num === CURRENT_STEP
                    ? `${styles.stepCircle} ${styles.stepCircleActive}`
                    : styles.stepCircle
                }
              >
                {step.num < CURRENT_STEP ? checkSvg : step.num}
              </div>
              <span className={styles.stepItemLabel}>{step.label}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Progress Bar */}
      <div className={styles.progressSection}>
        <div className={styles.progressBarTrack}>
          <div className={styles.progressBarFill} style={{ width: `${PERCENT}%` }} />
        </div>
        <span className={styles.progressText}>{PERCENT}% Complete</span>
      </div>

      {/* Placeholder */}
      <div className={styles.formCard}>
        <p className={styles.formTitle}>Review &amp; Sign</p>
        <p className={styles.formSubtitle}>Coming soon.</p>

        <div className={styles.buttonRow}>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={() => router.push("/onboarding")}
          >
            Save &amp; Exit
          </button>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={handleFinish}
            disabled={submitting}
          >
            <span>{submitting ? "…" : "Save & Continue"}</span>
            <span className={styles.btnArrow}>›</span>
          </button>
        </div>
      </div>
    </div>
  );
}
