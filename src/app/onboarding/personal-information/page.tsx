"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import Toast from "@/components/Toast";
import { useLang } from "@/components/LanguageProvider";
import styles from "./page.module.css";

const CURRENT_STEP = 1;
const TOTAL_STEPS = 7;
const PERCENT = Math.round((CURRENT_STEP / TOTAL_STEPS) * 100);

export default function PersonalInformationPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useLang();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [preferredName, setPreferredName] = useState("");
  const [gender, setGender] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [email, setEmail] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorTitle, setErrorTitle] = useState("Required Fields Missing");
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [showToast, setShowToast] = useState(false);

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
        if (typeof data.gender === "string") setGender(data.gender);
        if (typeof data.mobileNumber === "string") setMobileNumber(data.mobileNumber);
        if (typeof data.email === "string") setEmail(data.email);
      } catch {
        // Silent — user can still fill the form from scratch.
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
        firstName,
        lastName,
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
      {/* Header. No back arrow: every way out of this step is at the bottom
          of the form, and the one at the top went back without saving — a
          chevron that silently discards a half-filled form is a trap, and
          "Save & Exit" is the same journey with the work kept. */}
      <div className={styles.header}>
        <h1 className={styles.title}>{t("onb.personal.title")}</h1>

        {/* Where you are, said once. "Step 1 of 7", the bar and the
            percentage are three readings of the same number, so they sit
            together. They replace a row of seven numbered circles whose
            labels were set at 8px — small enough that the row was really
            just decoration, and it cost the top third of the first screen
            of the form somebody was sent here to fill in. */}
        <div className={styles.progressSection}>
          <div className={styles.progressMeta}>
            <span className={styles.stepLabel}>
              {t("onb.stepPrefix")} {CURRENT_STEP} {t("onb.stepOf")} {TOTAL_STEPS}
            </span>
            <span className={styles.progressText}>{PERCENT}{t("onb.percentComplete")}</span>
          </div>
          <div className={styles.progressBarTrack}>
            <div
              className={styles.progressBarFill}
              style={{ width: `${PERCENT}%` }}
            />
          </div>
        </div>
      </div>

      {/* Form Card */}
      <div className={styles.formCard}>
        <p className={styles.formTitle}>{t("onb.personal.formTitle")}</p>
        <p className={styles.formSubtitle}>{t("onb.personal.formSubtitle")}</p>

        {error && <p className={styles.errorMessage}>{error}</p>}

        <form className={styles.form} onSubmit={(e) => e.preventDefault()}>
          {/* Legal first and last name, on one line. They are one answer
              asked in two halves, and they are the two shortest fields on
              the form — stacked, they spent two full rows saying what fits
              in one and pushed everything else further down the phone. */}
          <div className={styles.nameRow}>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>
                {t("onb.personal.legalFirstName")} <span className={styles.required}>*</span>
              </label>
              <div className={styles.inputWrapper}>
                <span className={styles.inputIcon}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </span>
                <input
                  type="text"
                  className={styles.input}
                  placeholder={t("onb.personal.firstNameEg")}
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.label}>
                {t("onb.personal.legalLastName")} <span className={styles.required}>*</span>
              </label>
              <div className={styles.inputWrapper}>
                <span className={styles.inputIcon}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </span>
                <input
                  type="text"
                  className={styles.input}
                  placeholder={t("onb.personal.lastNameEg")}
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Preferred Name */}
          <div className={styles.fieldGroup}>
            <label className={styles.label}>{t("onb.personal.preferredName")}</label>
            <div className={styles.inputWrapper}>
              <span className={styles.inputIcon}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              </span>
              <input
                type="text"
                className={styles.input}
                placeholder={t("onb.personal.firstNameEg")}
                value={preferredName}
                onChange={(e) => setPreferredName(e.target.value)}
              />
            </div>
          </div>

          {/* Date of birth is not asked here. It is asked on the next step,
              as part of the TFN declaration, where it is required and where
              it is the ATO's question rather than ours — and asking for it
              twice in two screens is how you end up with two answers. That
              step writes it to the same place this one used to, so the
              employee record and the owner's review are unchanged. */}

          {/* Gender */}
          <div className={styles.fieldGroup}>
            <label className={styles.label}>
              {t("onb.personal.gender")} <span className={styles.required}>*</span>
            </label>
            <div className={styles.selectWrapper}>
              <select
                className={styles.select}
                value={gender}
                onChange={(e) => setGender(e.target.value)}
              >
                <option value="">{t("onb.personal.selectDefault")}</option>
                <option value="male">{t("onb.personal.male")}</option>
                <option value="female">{t("onb.personal.female")}</option>
              </select>
              <span className={styles.selectIcon}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              </span>
            </div>
          </div>

          {/* Mobile Number */}
          <div className={styles.fieldGroup}>
            <label className={styles.label}>
              {t("onb.personal.mobile")} <span className={styles.required}>*</span>
            </label>
            <div className={styles.inputWrapper}>
              <span className={styles.inputIcon}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.18 6.18l1.28-1.28a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
              </span>
              <input
                type="tel"
                className={styles.input}
                placeholder={t("onb.personal.mobilePlaceholder")}
                value={mobileNumber}
                onChange={(e) => setMobileNumber(e.target.value)}
              />
            </div>
          </div>

          {/* Email Address */}
          <div className={styles.fieldGroup}>
            <label className={styles.label}>
              {t("onb.personal.email")} <span className={styles.required}>*</span>
            </label>
            <div className={styles.inputWrapper}>
              <span className={styles.inputIcon}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
              </span>
              <input
                type="email"
                className={styles.input}
                placeholder={t("onb.personal.emailPlaceholder")}
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
              {saving ? t("common.loading") : t("common.saveAndExit")}
            </button>
            <button
              type="submit"
              className={styles.btnPrimary}
              onClick={handleSaveAndContinue}
              disabled={saving}
            >
              {saving ? t("common.loading") : <><span>{t("common.saveAndContinue")}</span> <span className={styles.btnArrow}>›</span></>}
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
