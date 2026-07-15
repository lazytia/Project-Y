"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { useLang } from "@/components/LanguageProvider";
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

const CURRENT_STEP = 3;
const TOTAL_STEPS = 7;
const PERCENT = Math.round((3 / 7) * 100);

export default function BankSuperDetailsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useLang();

  const [bsb, setBsb] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [superFundName, setSuperFundName] = useState("");
  const [usi, setUsi] = useState("");
  const [memberNumber, setMemberNumber] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorTitle, setErrorTitle] = useState("Required Fields Missing");
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [showToast, setShowToast] = useState(false);

  // Restore previously saved values when revisiting this step.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(getDb(), "staff_onboarding", user.uid));
        if (cancelled || !snap.exists()) return;
        const b = (snap.data() as { bankSuper?: Record<string, unknown> }).bankSuper;
        if (!b) return;
        if (typeof b.bsb === "string") setBsb(b.bsb);
        if (typeof b.accountNumber === "string") setAccountNumber(b.accountNumber);
        if (typeof b.accountName === "string") setAccountName(b.accountName);
        if (typeof b.superFundName === "string") setSuperFundName(b.superFundName);
        if (typeof b.usi === "string") setUsi(b.usi);
        if (typeof b.memberNumber === "string") setMemberNumber(b.memberNumber);
      } catch {
        // Silent.
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

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
        bankSuper: { bsb, accountNumber, accountName, superFundName, usi, memberNumber },
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
    if (!bsb.trim()) missing.push("BSB");
    if (!accountNumber.trim()) missing.push("Account Number");
    if (!accountName.trim()) missing.push("Account Name");
    if (!superFundName.trim()) missing.push("Super Fund Name");
    if (!usi.trim()) missing.push("USI (Unique Superannuation Identifier)");
    if (!memberNumber.trim()) missing.push("Member Number");

    if (missing.length > 0) {
      setErrorTitle("Required Fields Missing");
      setError(`Please fill in the required fields:\n${missing.join("\n")}`);
      setShowErrorModal(true);
      return;
    }

    const ok = await saveToFirestore(true);
    if (ok) {
      setShowToast(true);
      setTimeout(() => router.push("/onboarding/documents"), 1800);
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

  const bankSvg = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="22" x2="21" y2="22" />
      <line x1="6" y1="18" x2="6" y2="11" />
      <line x1="10" y1="18" x2="10" y2="11" />
      <line x1="14" y1="18" x2="14" y2="11" />
      <line x1="18" y1="18" x2="18" y2="11" />
      <polygon points="12 2 20 7 4 7" />
    </svg>
  );

  const searchSvg = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );

  const lightbulbSvg = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="9" y1="18" x2="15" y2="18" />
      <line x1="10" y1="22" x2="14" y2="22" />
      <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" />
    </svg>
  );

  const infoCircleSvg = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <button
          type="button"
          className={styles.backBtn}
          onClick={() => router.push("/onboarding/tfn-declaration")}
          aria-label="Back to TFN declaration"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <p className={styles.stepLabel}>{t("onb.stepPrefix")} {CURRENT_STEP} {t("onb.stepOf")} {TOTAL_STEPS}</p>
        <h1 className={styles.title}>{t("onb.bank.title")}</h1>
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
        <p className={styles.formTitle}>{t("onb.bank.formTitle")}</p>
        <p className={styles.formSubtitle}>{t("onb.bank.formSubtitle")}</p>

        <form className={styles.form} onSubmit={(e) => e.preventDefault()}>

          {/* ── Section 1: Bank Details ── */}
          <div className={styles.formSection}>
            <h3 className={styles.sectionTitle}>{t("onb.bank.bankSection")}</h3>

            {/* BSB */}
            <div className={styles.fieldGroup}>
              <label className={styles.label}>
                {t("onb.bank.bsb")} <span className={styles.required}>*</span>
              </label>
              <div className={styles.inputWrapper}>
                <span className={styles.inputIcon}>{bankSvg}</span>
                <input
                  type="text"
                  className={styles.input}
                  placeholder={t("onb.bank.bsbEg")}
                  value={bsb}
                  onChange={(e) => setBsb(e.target.value)}
                />
              </div>
            </div>

            {/* Account Number */}
            <div className={styles.fieldGroup}>
              <label className={styles.label}>
                {t("onb.bank.accountNumber")} <span className={styles.required}>*</span>
              </label>
              <div className={styles.inputWrapper}>
                <input
                  type="text"
                  className={`${styles.input} ${styles.inputNoIcon}`}
                  placeholder={t("onb.bank.accountNumberEg")}
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                />
              </div>
            </div>

            {/* Account Name */}
            <div className={styles.fieldGroup}>
              <label className={styles.label}>
                {t("onb.bank.accountName")} <span className={styles.required}>*</span>
              </label>
              <div className={styles.inputWrapper}>
                <input
                  type="text"
                  className={`${styles.input} ${styles.inputNoIcon}`}
                  placeholder={t("onb.bank.accountNameEg")}
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* ── Section 2: Superannuation Details ── */}
          <div className={styles.formSection}>
            <h3 className={styles.sectionTitle}>{t("onb.bank.superSection")}</h3>

            {/* Info Box: Why do we need this? */}
            <div className={styles.infoBox}>
              <div className={styles.infoBoxRow}>
                <span className={styles.infoBoxIcon}>{lightbulbSvg}</span>
                <div>
                  <p className={styles.infoBoxTitle}>{t("onb.bank.whyTitle")}</p>
                  <p className={styles.infoBoxBody}>{t("onb.bank.whyBody")}</p>
                </div>
              </div>
            </div>

            {/* Super Fund Name */}
            <div className={styles.fieldGroup}>
              <label className={styles.label}>
                {t("onb.bank.superFund")} <span className={styles.required}>*</span>
              </label>
              <div className={styles.inputWrapper}>
                <span className={styles.inputIcon}>{searchSvg}</span>
                <input
                  type="text"
                  className={styles.input}
                  placeholder={t("onb.bank.superFundEg")}
                  value={superFundName}
                  onChange={(e) => setSuperFundName(e.target.value)}
                />
              </div>
            </div>

            {/* USI */}
            <div className={styles.fieldGroup}>
              <label className={styles.label}>
                {t("onb.bank.usi")} <span className={styles.required}>*</span>
              </label>
              <div className={styles.inputWrapper}>
                <input
                  type="text"
                  className={`${styles.input} ${styles.inputNoIcon}`}
                  placeholder={t("onb.bank.usiEg")}
                  value={usi}
                  onChange={(e) => setUsi(e.target.value)}
                />
              </div>
            </div>

            {/* Member Number */}
            <div className={styles.fieldGroup}>
              <label className={styles.label}>
                {t("onb.bank.memberNumber")} <span className={styles.required}>*</span>
              </label>
              <div className={styles.inputWrapper}>
                <input
                  type="text"
                  className={`${styles.input} ${styles.inputNoIcon}`}
                  placeholder={t("onb.bank.memberNumberEg")}
                  value={memberNumber}
                  onChange={(e) => setMemberNumber(e.target.value)}
                />
              </div>
            </div>

            {/* Info Box: Don't have a super fund yet? */}
            <div className={styles.infoBox}>
              <div className={styles.infoBoxRow}>
                <span className={styles.infoBoxIcon}>{infoCircleSvg}</span>
                <p className={styles.infoBoxBody}>{t("onb.bank.noSuperNote")}</p>
              </div>
            </div>
          </div>

          {/* Buttons */}
          <div className={styles.buttonRow}>
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={handleSaveAndExit}
              disabled={saving}
            >
              {saving ? t("common.loading") : t("common.saveAndExit")}
            </button>
            <button
              type="submit"
              className={styles.btnPrimary}
              onClick={handleSaveAndContinue}
              disabled={saving}
            >
              {saving ? t("common.loading") : (
                <>
                  <span>{t("common.saveAndContinue")}</span>
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
          title="Bank & Super Details completed"
          message="Great! Your bank and super details have been saved."
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
