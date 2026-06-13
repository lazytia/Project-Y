"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import Toast from "@/components/Toast";
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

const CURRENT_STEP = 5;
const TOTAL_STEPS = 7;
const PERCENT = Math.round(((CURRENT_STEP - 1) / TOTAL_STEPS) * 100);

export default function PoliciesPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [handbookAgreed, setHandbookAgreed] = useState(false);
  const [privacyAgreed, setPrivacyAgreed] = useState(false);
  const [agreementAgreed, setAgreementAgreed] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorTitle, setErrorTitle] = useState("Acknowledgement Required");
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [showToast, setShowToast] = useState(false);

  async function saveToFirestore(markComplete = false) {
    if (!user) {
      setError("Could not find your login info. Please sign in again.");
      return false;
    }
    setSaving(true);
    setError(null);
    try {
      const db = getDb();
      const payload: Record<string, unknown> = {
        uid: user.uid,
        policies: { handbookAgreed, privacyAgreed, agreementAgreed },
        step: CURRENT_STEP,
        status: markComplete ? "step_complete" : "in_progress",
        updatedAt: serverTimestamp(),
      };
      if (markComplete) payload.completedStep = CURRENT_STEP;
      await setDoc(doc(db, "staff_onboarding", user.uid), payload, { merge: true });
      return true;
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to save. Please try again.";
      setError(msg);
      setErrorTitle("Save Failed");
      setShowErrorModal(true);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveAndContinue() {
    const missing: string[] = [];
    if (!handbookAgreed) missing.push("Staff Handbook");
    if (!privacyAgreed) missing.push("Privacy Policy");
    if (!agreementAgreed) missing.push("Employee Agreement");

    if (missing.length > 0) {
      setErrorTitle("Acknowledgement Required");
      setError(`Please acknowledge the following policies:\n${missing.join("\n")}`);
      setShowErrorModal(true);
      return;
    }

    const ok = await saveToFirestore(true);
    if (ok) {
      setShowToast(true);
      setTimeout(() => router.push("/onboarding/review-sign"), 1800);
    }
  }

  async function handleSaveAndExit() {
    const ok = await saveToFirestore(false);
    if (ok) router.push("/onboarding");
  }

  const checkSvg = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );

  const bookSvg = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );

  const lockSvg = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );

  const docSvg = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <button
          type="button"
          className={styles.backBtn}
          onClick={() => router.push("/onboarding/documents")}
          aria-label="Back to Documents"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <p className={styles.stepLabel}>Step {CURRENT_STEP} of {TOTAL_STEPS}</p>
        <h1 className={styles.title}>Policies</h1>
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
          <div
            className={styles.progressBarFill}
            style={{ width: `${PERCENT}%` }}
          />
        </div>
        <span className={styles.progressText}>{PERCENT}% Complete</span>
      </div>

      {/* Form Card */}
      <div className={styles.formCard}>
        <p className={styles.formTitle}>Review and acknowledge our workplace policies.</p>
        <p className={styles.formSubtitle}>All policies must be acknowledged before proceeding.</p>

        <form className={styles.form} onSubmit={(e) => e.preventDefault()}>

          {/* ── Section 1: Staff Handbook ── */}
          <div className={styles.formSection}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionIcon}>{bookSvg}</span>
              <h3 className={styles.sectionTitle}>Staff Handbook</h3>
            </div>
            <div className={styles.infoBox}>
              <p className={styles.infoBoxBody}>
                Our Staff Handbook outlines workplace expectations, code of conduct, leave entitlements, and your rights and responsibilities as an employee.
              </p>
            </div>
            <label className={`${styles.policyCheck} ${handbookAgreed ? styles.policyCheckActive : ""}`}>
              <input
                type="checkbox"
                className={styles.checkboxInput}
                checked={handbookAgreed}
                onChange={(e) => setHandbookAgreed(e.target.checked)}
              />
              <span className={styles.checkboxLabel}>I have read and understood the Staff Handbook</span>
            </label>
          </div>

          {/* ── Section 2: Privacy Policy ── */}
          <div className={styles.formSection}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionIcon}>{lockSvg}</span>
              <h3 className={styles.sectionTitle}>Privacy Policy</h3>
            </div>
            <div className={styles.infoBox}>
              <p className={styles.infoBoxBody}>
                We are committed to protecting your personal information. This policy explains how we collect, use, and store your data in compliance with the Privacy Act 1988.
              </p>
            </div>
            <label className={`${styles.policyCheck} ${privacyAgreed ? styles.policyCheckActive : ""}`}>
              <input
                type="checkbox"
                className={styles.checkboxInput}
                checked={privacyAgreed}
                onChange={(e) => setPrivacyAgreed(e.target.checked)}
              />
              <span className={styles.checkboxLabel}>I have read and understood the Privacy Policy</span>
            </label>
          </div>

          {/* ── Section 3: Employee Agreement ── */}
          <div className={styles.formSection}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionIcon}>{docSvg}</span>
              <h3 className={styles.sectionTitle}>Employee Agreement</h3>
            </div>
            <div className={styles.infoBox}>
              <p className={styles.infoBoxBody}>
                This agreement sets out the terms and conditions of your employment, including your role, remuneration, hours of work, and leave entitlements.
              </p>
            </div>
            <label className={`${styles.policyCheck} ${agreementAgreed ? styles.policyCheckActive : ""}`}>
              <input
                type="checkbox"
                className={styles.checkboxInput}
                checked={agreementAgreed}
                onChange={(e) => setAgreementAgreed(e.target.checked)}
              />
              <span className={styles.checkboxLabel}>I have read and understood the Employee Agreement</span>
            </label>
          </div>

          {/* Buttons */}
          <div className={styles.buttonRow}>
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={handleSaveAndExit}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save & Exit"}
            </button>
            <button
              type="submit"
              className={styles.btnPrimary}
              onClick={handleSaveAndContinue}
              disabled={saving}
            >
              {saving ? "Saving..." : (
                <>
                  <span>Save &amp; Continue</span>
                  <span className={styles.btnArrow}>›</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Toast */}
      {showToast && (
        <Toast
          title="Policies acknowledged"
          message="All policies have been read and acknowledged."
          onClose={() => setShowToast(false)}
        />
      )}

      {/* Error Modal */}
      {showErrorModal && (
        <div className={styles.modalBackdrop} onClick={() => setShowErrorModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalIcon}>⚠️</div>
            <h3 className={styles.modalTitle}>{errorTitle}</h3>
            <ul className={styles.modalList}>
              {error?.split("\n").slice(1).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <button
              className={styles.modalBtn}
              onClick={() => setShowErrorModal(false)}
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
