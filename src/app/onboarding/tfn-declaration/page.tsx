"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import CalendarPicker from "@/components/CalendarPicker";
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

const CURRENT_STEP = 2;
const TOTAL_STEPS = 7;
const PERCENT = Math.round((2 / 7) * 100);

function formatDobDisplay(raw: string): string {
  if (!raw) return "";
  const [y, m, d] = raw.split("-");
  return `${d} / ${m} / ${y}`;
}

function getTodayDisplay(): string {
  return new Date().toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function TfnDeclarationPage() {
  const router = useRouter();
  const { user } = useAuth();

  // Section 1: Personal Details
  const [fullLegalName, setFullLegalName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [homeAddress, setHomeAddress] = useState("");
  const [suburb, setSuburb] = useState("");
  const [auState, setAuState] = useState("");
  const [postcode, setPostcode] = useState("");

  // Section 2: TFN
  const [taxFileNumber, setTaxFileNumber] = useState("");

  // Section 3: Tax Details
  const [taxResident, setTaxResident] = useState("yes");
  const [taxFreeThreshold, setTaxFreeThreshold] = useState("yes");
  const [helpDebt, setHelpDebt] = useState("no");
  const [otherGovDebt, setOtherGovDebt] = useState("no");

  // Section 4: Declaration
  const [declarationAgreed, setDeclarationAgreed] = useState(false);
  const [declarationName, setDeclarationName] = useState("");

  const [showCalendar, setShowCalendar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorTitle, setErrorTitle] = useState("Required Fields Missing");
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [showToast, setShowToast] = useState(false);

  const todayKey = new Date().toLocaleDateString("en-CA");
  const declarationDate = getTodayDisplay();

  async function saveToFirestore() {
    if (!user) {
      setError("Could not find your login info. Please sign in again.");
      return false;
    }
    setSaving(true);
    setError(null);
    try {
      const db = getDb();
      await setDoc(
        doc(db, "staff_onboarding", user.uid),
        {
          uid: user.uid,
          tfn: {
            fullLegalName,
            dateOfBirth,
            homeAddress,
            suburb,
            state: auState,
            postcode,
            taxFileNumber,
            taxResident,
            taxFreeThreshold,
            helpDebt,
            otherGovDebt,
            declarationName,
            declarationAgreed: true,
          },
          step: 2,
          status: "in_progress",
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
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
    if (!fullLegalName.trim()) missing.push("Full Legal Name");
    if (!dateOfBirth) missing.push("Date of Birth");
    if (!homeAddress.trim()) missing.push("Home Address");
    if (!suburb.trim()) missing.push("Suburb / Town");
    if (!auState) missing.push("State");
    if (!postcode.trim()) missing.push("Postcode");
    if (!taxFileNumber.trim()) missing.push("Tax File Number");
    if (!declarationAgreed) missing.push("Employee Declaration (must be checked)");
    if (!declarationName.trim()) missing.push("Full Name (Declaration)");

    if (missing.length > 0) {
      setErrorTitle("Required Fields Missing");
      setError(`Please fill in the required fields:\n${missing.join("\n")}`);
      setShowErrorModal(true);
      return;
    }

    const ok = await saveToFirestore();
    if (ok) {
      setShowToast(true);
      setTimeout(() => router.push("/onboarding/bank-super-details"), 1800);
    }
  }

  async function handleSaveAndExit() {
    const ok = await saveToFirestore();
    if (ok) router.push("/onboarding");
  }

  const calendarSvg = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );

  const personSvg = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );

  const shieldSvg = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );

  const infoCircleSvg = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );

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
          onClick={() => router.push("/onboarding/personal-information")}
          aria-label="Back to personal information"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <p className={styles.stepLabel}>Step {CURRENT_STEP} of {TOTAL_STEPS}</p>
        <h1 className={styles.title}>TFN Declaration</h1>
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
        <p className={styles.formTitle}>Complete your TFN Declaration.</p>
        <p className={styles.formSubtitle}>All fields marked with * are required.</p>

        <form className={styles.form} onSubmit={(e) => e.preventDefault()}>

          {/* ── Section 1: Personal Details ── */}
          <div className={styles.formSection}>
            <h3 className={styles.sectionTitle}>Personal Details</h3>

            {/* Full Legal Name */}
            <div className={styles.fieldGroup}>
              <label className={styles.label}>
                Full Legal Name <span className={styles.required}>*</span>
              </label>
              <div className={styles.inputWrapper}>
                <span className={styles.inputIcon}>{personSvg}</span>
                <input
                  type="text"
                  className={styles.input}
                  placeholder="Enter your full legal name"
                  value={fullLegalName}
                  onChange={(e) => setFullLegalName(e.target.value)}
                />
              </div>
            </div>

            {/* Date of Birth */}
            <div className={styles.fieldGroup}>
              <label className={styles.label}>
                Date of Birth <span className={styles.required}>*</span>
              </label>
              <div className={styles.inputWrapper}>
                <span className={styles.inputIcon}>{calendarSvg}</span>
                <input
                  type="text"
                  readOnly
                  className={`${styles.input} ${styles.inputWithRightIcon}`}
                  placeholder="DD / MM / YYYY"
                  value={formatDobDisplay(dateOfBirth)}
                  onClick={() => setShowCalendar(true)}
                />
                <button
                  type="button"
                  className={styles.inputIconRightBtn}
                  onClick={() => setShowCalendar(true)}
                  aria-label="Open date picker"
                >
                  {calendarSvg}
                </button>
              </div>
            </div>

            {showCalendar && (
              <CalendarPicker
                singleOnly
                value={dateOfBirth || todayKey}
                maxDate={todayKey}
                minDate="1900-01-01"
                onChange={(dateKey) => {
                  setDateOfBirth(dateKey);
                  setShowCalendar(false);
                }}
                onRangeChange={() => {}}
                onClose={() => setShowCalendar(false)}
              />
            )}

            {/* Home Address */}
            <div className={styles.fieldGroup}>
              <label className={styles.label}>
                Home Address <span className={styles.required}>*</span>
              </label>
              <div className={styles.inputWrapper}>
                <span className={styles.inputIcon}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                </span>
                <input
                  type="text"
                  className={styles.input}
                  placeholder="Start typing your address"
                  value={homeAddress}
                  onChange={(e) => setHomeAddress(e.target.value)}
                />
              </div>
            </div>

            {/* Suburb / Town */}
            <div className={styles.fieldGroup}>
              <label className={styles.label}>
                Suburb / Town <span className={styles.required}>*</span>
              </label>
              <div className={styles.inputWrapper}>
                <input
                  type="text"
                  className={`${styles.input} ${styles.inputNoIcon}`}
                  placeholder="Enter suburb or town"
                  value={suburb}
                  onChange={(e) => setSuburb(e.target.value)}
                />
              </div>
            </div>

            {/* State + Postcode */}
            <div className={styles.fieldRowTwo}>
              <div className={styles.fieldGroup}>
                <label className={styles.label}>
                  State <span className={styles.required}>*</span>
                </label>
                <div className={styles.selectWrapper}>
                  <select
                    className={styles.select}
                    value={auState}
                    onChange={(e) => setAuState(e.target.value)}
                  >
                    <option value="">Select</option>
                    <option value="ACT">ACT</option>
                    <option value="NSW">NSW</option>
                    <option value="NT">NT</option>
                    <option value="QLD">QLD</option>
                    <option value="SA">SA</option>
                    <option value="TAS">TAS</option>
                    <option value="VIC">VIC</option>
                    <option value="WA">WA</option>
                  </select>
                  <span className={styles.selectIcon}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </span>
                </div>
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.label}>
                  Postcode <span className={styles.required}>*</span>
                </label>
                <div className={styles.inputWrapper}>
                  <input
                    type="text"
                    className={`${styles.input} ${styles.inputNoIcon}`}
                    placeholder="e.g. 2000"
                    value={postcode}
                    onChange={(e) => setPostcode(e.target.value)}
                    maxLength={4}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ── Section 2: TFN ── */}
          <div className={styles.formSection}>
            <h3 className={styles.sectionTitle}>Your Tax File Number (TFN)</h3>

            <div className={styles.fieldGroup}>
              <label className={styles.label}>
                Tax File Number (TFN) <span className={styles.required}>*</span>
              </label>
              <div className={styles.inputWrapper}>
                <span className={styles.inputIcon}>{personSvg}</span>
                <input
                  type="text"
                  className={styles.input}
                  placeholder="Enter your TFN"
                  value={taxFileNumber}
                  onChange={(e) => setTaxFileNumber(e.target.value)}
                />
              </div>
              <p className={styles.secureNote}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                We keep your information secure and private.
              </p>
            </div>
          </div>

          {/* ── Section 3: Tax Details ── */}
          <div className={styles.formSection}>
            <h3 className={styles.sectionTitle}>Tax Details</h3>

            {/* Tax Resident */}
            <div className={styles.fieldGroup}>
              <p className={styles.questionLabel}>
                Are you an Australian tax resident? <span className={styles.required}>*</span>
              </p>
              <div className={styles.radioGroup}>
                {[
                  { value: "yes", label: "Yes" },
                  { value: "no", label: "No" },
                  { value: "working_holiday", label: "Working Holiday Visa Holder" },
                ].map((opt) => (
                  <label key={opt.value} className={styles.radioItem}>
                    <input
                      type="radio"
                      className={styles.radioInput}
                      name="taxResident"
                      value={opt.value}
                      checked={taxResident === opt.value}
                      onChange={() => setTaxResident(opt.value)}
                    />
                    <span className={styles.radioLabel}>{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Tax Free Threshold */}
            <div className={styles.fieldGroup}>
              <p className={styles.questionLabel}>
                Claim the tax-free threshold from this payer? <span className={styles.required}>*</span>
              </p>
              <div className={styles.radioGroup}>
                {[
                  { value: "yes", label: "Yes" },
                  { value: "no", label: "No" },
                ].map((opt) => (
                  <label key={opt.value} className={styles.radioItem}>
                    <input
                      type="radio"
                      className={styles.radioInput}
                      name="taxFreeThreshold"
                      value={opt.value}
                      checked={taxFreeThreshold === opt.value}
                      onChange={() => setTaxFreeThreshold(opt.value)}
                    />
                    <span className={styles.radioLabel}>{opt.label}</span>
                  </label>
                ))}
              </div>
              <p className={styles.mostNote}>Most employees select Yes.</p>
            </div>

            {/* HELP Debt */}
            <div className={styles.fieldGroup}>
              <div className={styles.questionRow}>
                <p className={styles.questionLabel}>
                  Do you have a HELP / Student Loan debt? <span className={styles.required}>*</span>
                </p>
                <button type="button" className={styles.infoIconBtn} aria-label="More information about HELP debt">
                  {infoCircleSvg}
                </button>
              </div>
              <div className={styles.radioGroup}>
                {[
                  { value: "no", label: "No" },
                  { value: "yes", label: "Yes" },
                ].map((opt) => (
                  <label key={opt.value} className={styles.radioItem}>
                    <input
                      type="radio"
                      className={styles.radioInput}
                      name="helpDebt"
                      value={opt.value}
                      checked={helpDebt === opt.value}
                      onChange={() => setHelpDebt(opt.value)}
                    />
                    <span className={styles.radioLabel}>{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Other Gov Debt */}
            <div className={styles.fieldGroup}>
              <div className={styles.questionRow}>
                <p className={styles.questionLabel}>
                  Do you have any other government education debt?
                </p>
                <button type="button" className={styles.infoIconBtn} aria-label="More information about government education debt">
                  {infoCircleSvg}
                </button>
              </div>
              <div className={styles.radioGroup}>
                {[
                  { value: "no", label: "No" },
                  { value: "yes", label: "Yes" },
                ].map((opt) => (
                  <label key={opt.value} className={styles.radioItem}>
                    <input
                      type="radio"
                      className={styles.radioInput}
                      name="otherGovDebt"
                      value={opt.value}
                      checked={otherGovDebt === opt.value}
                      onChange={() => setOtherGovDebt(opt.value)}
                    />
                    <span className={styles.radioLabel}>{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* ── Section 4: Declaration ── */}
          <div className={styles.formSection}>
            <h3 className={styles.sectionTitle}>Declaration</h3>

            {/* Declaration checkbox */}
            <div className={styles.fieldGroup}>
              <label className={styles.checkboxItem}>
                <input
                  type="checkbox"
                  className={styles.checkboxInput}
                  checked={declarationAgreed}
                  onChange={(e) => setDeclarationAgreed(e.target.checked)}
                />
                <span className={styles.radioLabel}>
                  Employee Declaration <span className={styles.required}>*</span> — I declare that the information I have given is true and correct.
                </span>
              </label>
            </div>

            {/* Full Name */}
            <div className={styles.fieldGroup}>
              <label className={styles.label}>
                Full Name <span className={styles.required}>*</span>
              </label>
              <div className={styles.inputWrapper}>
                <input
                  type="text"
                  className={`${styles.input} ${styles.inputNoIcon}`}
                  placeholder="Enter your full name"
                  value={declarationName}
                  onChange={(e) => setDeclarationName(e.target.value)}
                />
              </div>
            </div>

            {/* Date (read-only) */}
            <div className={styles.fieldGroup}>
              <label className={styles.label}>
                Date <span className={styles.required}>*</span>
              </label>
              <div className={styles.inputWrapper}>
                <input
                  type="text"
                  readOnly
                  className={`${styles.input} ${styles.inputNoIcon} ${styles.inputWithRightIcon}`}
                  value={declarationDate}
                />
                <span className={styles.inputIconRight}>{calendarSvg}</span>
              </div>
            </div>

            <div className={styles.infoBox}>
              <div className={styles.infoBoxRow}>
                {shieldSvg}
                <span>Submitted electronically via Project Y</span>
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
          title="TFN Declaration completed"
          message="Great! Your TFN details have been saved."
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
