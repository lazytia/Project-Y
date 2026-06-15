"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
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

const CURRENT_STEP = 1;
const TOTAL_STEPS = 7;
const PERCENT = Math.round((CURRENT_STEP / TOTAL_STEPS) * 100);

export default function PersonalInformationPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [preferredName, setPreferredName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [email, setEmail] = useState("");

  const [showCalendar, setShowCalendar] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorTitle, setErrorTitle] = useState("Required Fields Missing");
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [showToast, setShowToast] = useState(false);

  const todayKey = new Date().toLocaleDateString("en-CA");

  // Load any previously saved values so navigating back to this step doesn't
  // erase the user's input.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(getDb(), "staff_onboarding", user.uid));
        if (cancelled || !snap.exists()) return;
        const data = snap.data() as Record<string, unknown>;
        if (typeof data.firstName === "string") setFirstName(data.firstName);
        if (typeof data.lastName === "string") setLastName(data.lastName);
        if (typeof data.preferredName === "string") setPreferredName(data.preferredName);
        if (typeof data.dateOfBirth === "string") setDateOfBirth(data.dateOfBirth);
        if (typeof data.gender === "string") setGender(data.gender);
        if (typeof data.mobileNumber === "string") setMobileNumber(data.mobileNumber);
        if (typeof data.email === "string") setEmail(data.email);
      } catch {
        // Silent — user can still fill the form from scratch.
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  function formatDobDisplay(raw: string): string {
    if (!raw) return "";
    const [y, m, d] = raw.split("-");
    return `${d} / ${m} / ${y}`;
  }

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
        firstName,
        lastName,
        dateOfBirth,
        gender,
        mobileNumber,
        email,
        step: CURRENT_STEP,
        status: markComplete ? "step_complete" : "in_progress",
        updatedAt: serverTimestamp(),
      };
      if (preferredName.trim()) payload.preferredName = preferredName.trim();
      if (markComplete) payload.completedStep = CURRENT_STEP;
      await setDoc(doc(db, "staff_onboarding", user.uid), payload, { merge: true });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save. Please try again.";
      setError(msg);
      setErrorTitle("Save Failed");
      setShowErrorModal(true);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveAndContinue() {
    // Required field validation
    const missing: string[] = [];
    if (!firstName.trim()) missing.push("Legal First Name");
    if (!lastName.trim()) missing.push("Legal Last Name");
    if (!dateOfBirth) missing.push("Date of Birth");
    if (!gender) missing.push("Gender");
    if (!mobileNumber.trim()) missing.push("Mobile Number");
    if (!email.trim()) missing.push("Email Address");
    if (missing.length > 0) {
      setErrorTitle("Required Fields Missing");
      setError(`Please fill in the required fields:\n${missing.join("\n")}`);
      setShowErrorModal(true);
      return;
    }
    const ok = await saveToFirestore(true);
    if (ok) {
      setShowToast(true);
      setTimeout(() => router.push("/onboarding/tfn-declaration"), 1800);
    }
  }

  async function handleSaveAndExit() {
    const ok = await saveToFirestore(false);
    if (ok) router.push("/onboarding");
  }

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <button
          type="button"
          className={styles.backBtn}
          onClick={() => router.push("/onboarding")}
          aria-label="Back to onboarding"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <p className={styles.stepLabel}>Step {CURRENT_STEP} of {TOTAL_STEPS}</p>
        <h1 className={styles.title}>Personal Information</h1>
      </div>

      {/* Step Indicators */}
      <div className={styles.stepsContainer}>
        {STEPS.map((step, idx) => (
          <div key={step.num} className={styles.stepItem}>
            {idx > 0 && <div className={styles.connector} />}
            <div className={styles.stepCircleWrap}>
              <div
                className={
                  step.num === CURRENT_STEP
                    ? `${styles.stepCircle} ${styles.stepCircleActive}`
                    : styles.stepCircle
                }
              >
                {step.num}
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
        <p className={styles.formTitle}>Let&apos;s start with your personal details.</p>
        <p className={styles.formSubtitle}>All fields marked with * are required.</p>

        {error && <p className={styles.errorMessage}>{error}</p>}

        <form className={styles.form} onSubmit={(e) => e.preventDefault()}>
          {/* Legal First Name */}
          <div className={styles.fieldGroup}>
            <label className={styles.label}>
              Legal First Name <span className={styles.required}>*</span>
            </label>
            <div className={styles.inputWrapper}>
              <span className={styles.inputIcon}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              </span>
              <input
                type="text"
                className={styles.input}
                placeholder="e.g. Alex"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
          </div>

          {/* Legal Last Name */}
          <div className={styles.fieldGroup}>
            <label className={styles.label}>
              Legal Last Name <span className={styles.required}>*</span>
            </label>
            <div className={styles.inputWrapper}>
              <span className={styles.inputIcon}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              </span>
              <input
                type="text"
                className={styles.input}
                placeholder="e.g. Smith"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
          </div>

          {/* Preferred Name */}
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Preferred Name (Optional)</label>
            <div className={styles.inputWrapper}>
              <span className={styles.inputIcon}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              </span>
              <input
                type="text"
                className={styles.input}
                placeholder="e.g. Alex"
                value={preferredName}
                onChange={(e) => setPreferredName(e.target.value)}
              />
            </div>
          </div>

          {/* Date of Birth */}
          <div className={styles.fieldGroup}>
            <label className={styles.label}>
              Date of Birth <span className={styles.required}>*</span>
            </label>
            <div className={styles.inputWrapper}>
              <span className={styles.inputIcon}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              </span>
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
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
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

          {/* Gender */}
          <div className={styles.fieldGroup}>
            <label className={styles.label}>
              Gender <span className={styles.required}>*</span>
            </label>
            <div className={styles.selectWrapper}>
              <select
                className={styles.select}
                value={gender}
                onChange={(e) => setGender(e.target.value)}
              >
                <option value="">Select</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
              <span className={styles.selectIcon}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              </span>
            </div>
          </div>

          {/* Mobile Number */}
          <div className={styles.fieldGroup}>
            <label className={styles.label}>
              Mobile Number <span className={styles.required}>*</span>
            </label>
            <div className={styles.inputWrapper}>
              <span className={styles.inputIcon}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.18 6.18l1.28-1.28a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
              </span>
              <input
                type="tel"
                className={styles.input}
                placeholder="e.g. 0412 345 678"
                value={mobileNumber}
                onChange={(e) => setMobileNumber(e.target.value)}
              />
            </div>
          </div>

          {/* Email Address */}
          <div className={styles.fieldGroup}>
            <label className={styles.label}>
              Email Address <span className={styles.required}>*</span>
            </label>
            <div className={styles.inputWrapper}>
              <span className={styles.inputIcon}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
              </span>
              <input
                type="email"
                className={styles.input}
                placeholder="e.g. alex.smith@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
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
              {saving ? "Saving..." : <><span>Save &amp; Continue</span> <span className={styles.btnArrow}>›</span></>}
            </button>
          </div>
        </form>
      </div>

      {/* Toast */}
      {showToast && (
        <Toast
          title="Personal Information completed"
          message="Great! Your details have been saved."
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
