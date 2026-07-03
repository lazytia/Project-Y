"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { isOwner } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import { emailToUsername } from "@/lib/username";
import Splash from "@/components/Splash";
import Toast from "@/components/Toast";
import CalendarPicker from "@/components/CalendarPicker";
import styles from "./page.module.css";

/* ──────────────────────────────────────────────────────────────────────────
 * Onboarding → New Employee (manager view).
 * Adds a record to the `staff_onboarding` collection so the new employee
 * appears on the /people/onboarding list with a "Waiting for Documents"
 * status pill.
 * ────────────────────────────────────────────────────────────────────────── */

const POSITIONS = ["Hall Staff", "Kitchen Staff"] as const;
type Position = (typeof POSITIONS)[number];

const TRAINING_PERIODS = [
  { value: "First 2 Weeks", subtitle: "" },
  { value: "First 3 Weeks", subtitle: "" },
  {
    value: "Until Fully Trained",
    subtitle: "Until the person can perform their duties in full capacity",
  },
] as const;
type TrainingPeriod = (typeof TRAINING_PERIODS)[number]["value"];

const DEFAULT_STATUS = "Waiting for Documents";
const FAR_FUTURE = "2030-12-31";
const NOTES_MAX = 500;

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function requesterDisplayName(email: string | null | undefined): string {
  const u = emailToUsername(email).toLowerCase();
  if (u === "yurina") return "Yurina";
  if (u === "yurica") return "Yurica";
  if (u === "tia") return "Tia";
  if (!u) return "Manager";
  return u.charAt(0).toUpperCase() + u.slice(1);
}

function fmtIsoShort(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function NewEmployeePage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwner(user);

  useEffect(() => {
    if (authLoading) return;
    if (!allowed) router.replace(ROUTES.home);
  }, [authLoading, allowed, router]);

  const [givenName, setGivenName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [position, setPosition] = useState<Position>("Hall Staff");
  const [startDate, setStartDate] = useState("");
  const [visaExpiry, setVisaExpiry] = useState("");
  const [trainingRate, setTrainingRate] = useState("");
  const [trainingPeriod, setTrainingPeriod] = useState<TrainingPeriod>("First 2 Weeks");
  const [afterTrainingRate, setAfterTrainingRate] = useState("");
  const [notes, setNotes] = useState("");

  const [rateFocused, setRateFocused] = useState(false);
  const [calOpen, setCalOpen] = useState<"start" | "visa" | null>(null);
  const [periodSheetOpen, setPeriodSheetOpen] = useState(false);
  const [periodDraft, setPeriodDraft] = useState<TrainingPeriod>("First 2 Weeks");

  const [saving, setSaving] = useState(false);
  const [showToast, setShowToast] = useState(false);

  // Set default start date on mount (avoids SSR/client hydration mismatch).
  useEffect(() => {
    if (!startDate) setStartDate(todayIso());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const canSave =
    givenName.trim().length > 0 &&
    familyName.trim().length > 0 &&
    !!startDate &&
    !!trainingRate.trim() &&
    !Number.isNaN(parseFloat(trainingRate)) &&
    mobileNumber.trim().length > 0;

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const g = givenName.trim();
      const f = familyName.trim();
      await addDoc(collection(getDb(), "staff_onboarding"), {
        givenName: g,
        familyName: f,
        fullName: `${g} ${f}`,
        mobileNumber: mobileNumber.trim(),
        position,
        startDate,
        visaExpiry: visaExpiry || null,
        trainingRate: parseFloat(trainingRate),
        trainingPeriod,
        afterTrainingRate: afterTrainingRate.trim()
          ? parseFloat(afterTrainingRate)
          : null,
        notes: notes.trim(),
        status: DEFAULT_STATUS,
        role: "staff",
        requestedByUid: user?.uid ?? null,
        requestedByName: requesterDisplayName(user?.email),
        createdAt: serverTimestamp(),
      });
      setShowToast(true);
      window.setTimeout(() => router.push("/people/onboarding"), 900);
    } catch {
      setSaving(false);
      alert("Failed to create employee. Please try again.");
    }
  }

  if (authLoading) return <Splash />;
  if (!allowed) return null;

  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <button
          type="button"
          className={styles.backBtn}
          onClick={() => router.push("/people/onboarding")}
          aria-label="Back to onboarding"
        >
          <ChevronLeft />
        </button>
        <div className={styles.headerTitles}>
          <span className={styles.eyebrow}>Onboarding</span>
          <h1 className={styles.title}>New Employee</h1>
        </div>
        <span className={styles.headerSpacer} />
      </header>

      {/* Given / family name */}
      <div className={styles.dateRow}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="givenName">
            GIVEN NAME <span className={styles.required}>*</span>
          </label>
          <input
            id="givenName"
            type="text"
            className={styles.input}
            placeholder="e.g. Sakura"
            value={givenName}
            onChange={(e) => setGivenName(e.target.value)}
            maxLength={40}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="familyName">
            FAMILY NAME <span className={styles.required}>*</span>
          </label>
          <input
            id="familyName"
            type="text"
            className={styles.input}
            placeholder="e.g. Tanaka"
            value={familyName}
            onChange={(e) => setFamilyName(e.target.value)}
            maxLength={40}
          />
        </div>
      </div>

      {/* Mobile number */}
      <div className={styles.field}>
        <label className={styles.fieldLabel}>
          MOBILE NUMBER <span className={styles.required}>*</span>
        </label>
        <div className={styles.mobileWrap}>
          <span className={styles.countryCode}>+61</span>
          <span className={styles.mobileDivider} />
          <input
            type="tel"
            inputMode="tel"
            className={styles.mobileInput}
            placeholder="e.g. 412 345 678"
            value={mobileNumber}
            onChange={(e) => setMobileNumber(e.target.value)}
            maxLength={15}
          />
        </div>
      </div>

      {/* Mobile info box */}
      <div className={styles.infoBox}>
        <InfoIcon className={styles.infoIcon} />
        <p className={styles.infoText}>
          Mobile number is required. We will send the employee their Clock In ID
          and Project Y login details via SMS.
        </p>
      </div>

      {/* Position */}
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="position">
          POSITION
        </label>
        <div className={styles.selectWrap}>
          <select
            id="position"
            className={styles.select}
            value={position}
            onChange={(e) => setPosition(e.target.value as Position)}
          >
            {POSITIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <ChevronDown className={styles.selectChev} />
        </div>
      </div>

      {/* Start date + Visa expiry (side by side) */}
      <div className={styles.dateRow}>
        <div className={styles.field}>
          <label className={styles.fieldLabel}>START DATE</label>
          <button
            type="button"
            className={styles.pickerBtn}
            onClick={() => setCalOpen("start")}
          >
            <CalendarIcon className={styles.pickerLeadIcon} />
            <span className={styles.pickerValue}>{fmtIsoShort(startDate)}</span>
            <ChevronDown className={styles.selectChev} />
          </button>
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel}>
            VISA EXPIRY DATE <span className={styles.required}>*</span>
          </label>
          <button
            type="button"
            className={styles.pickerBtn}
            onClick={() => setCalOpen("visa")}
          >
            <CalendarIcon className={styles.pickerLeadIcon} />
            <span className={`${styles.pickerValue} ${!visaExpiry ? styles.pickerPlaceholder : ""}`}>
              {visaExpiry ? fmtIsoShort(visaExpiry) : "Select date"}
            </span>
            <ChevronDown className={styles.selectChev} />
          </button>
        </div>
      </div>
      <span className={styles.fieldHint}>
        <InfoIcon className={styles.hintIcon} /> We&rsquo;ll remind you before this date.
      </span>

      {/* Training rate */}
      <div className={styles.field}>
        <label className={styles.fieldLabel}>TRAINING RATE</label>
        <div
          className={`${styles.rateWrap} ${rateFocused ? styles.rateWrapFocused : ""}`}
        >
          <span
            className={`${styles.rateBadge} ${rateFocused ? styles.rateBadgeOn : ""}`}
            aria-hidden="true"
          >
            $
          </span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            className={styles.rateInput}
            placeholder="0.00"
            value={trainingRate}
            onChange={(e) => setTrainingRate(e.target.value)}
            onFocus={() => setRateFocused(true)}
            onBlur={() => setRateFocused(false)}
          />
          <span className={styles.rateSuffix}>/ hour</span>
        </div>
      </div>

      {/* Training period */}
      <div className={styles.field}>
        <label className={styles.fieldLabel}>TRAINING PERIOD</label>
        <button
          type="button"
          className={styles.pickerBtn}
          onClick={() => {
            setPeriodDraft(trainingPeriod);
            setPeriodSheetOpen(true);
          }}
        >
          <span className={styles.pickerValue}>{trainingPeriod}</span>
          <ChevronDown className={styles.selectChev} />
        </button>
      </div>

      {/* Info box */}
      <div className={styles.infoBox}>
        <InfoIcon className={styles.infoIcon} />
        <p className={styles.infoText}>
          This rate will apply for the selected training period above.
        </p>
      </div>

      {/* After training rate */}
      <div className={styles.field}>
        <label className={styles.fieldLabel}>AFTER TRAINING RATE</label>
        <div className={`${styles.rateWrap} ${styles.rateWrapMuted}`}>
          <span className={styles.rateBadge} aria-hidden="true">
            $
          </span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            className={styles.rateInput}
            placeholder="0.00"
            value={afterTrainingRate}
            onChange={(e) => setAfterTrainingRate(e.target.value)}
          />
          <span className={styles.rateSuffix}>/ hour</span>
        </div>
      </div>

      {/* Notes */}
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="notes">
          NOTES (OPTIONAL)
        </label>
        <textarea
          id="notes"
          className={styles.textarea}
          placeholder="e.g. Previous hospitality experience. Available weekends."
          value={notes}
          onChange={(e) => {
            if (e.target.value.length <= NOTES_MAX) setNotes(e.target.value);
          }}
          rows={4}
          maxLength={NOTES_MAX}
        />
      </div>

      {/* Submit */}
      <button
        type="button"
        className={styles.submitBtn}
        disabled={!canSave || saving}
        onClick={handleSave}
      >
        {saving ? "Creating…" : "Create Employee"}
      </button>

      {/* Calendar bottom sheet */}
      {calOpen && (
        <div className={styles.calOverlay} onClick={() => setCalOpen(null)}>
          <div className={styles.calSheet} onClick={(e) => e.stopPropagation()}>
            <CalendarPicker
              value={(calOpen === "visa" ? visaExpiry : startDate) || todayIso()}
              maxDate={FAR_FUTURE}
              singleOnly
              onChange={(dateKey) => {
                if (calOpen === "visa") setVisaExpiry(dateKey);
                else setStartDate(dateKey);
                setCalOpen(null);
              }}
              onRangeChange={() => {}}
              onClose={() => setCalOpen(null)}
            />
          </div>
        </div>
      )}

      {/* Training period bottom sheet */}
      {periodSheetOpen && (
        <div
          className={styles.sheetBackdrop}
          onClick={() => setPeriodSheetOpen(false)}
        >
          <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
            <div className={styles.sheetHandle} />
            <p className={styles.sheetTitle}>Training Period</p>
            <ul className={styles.optionList}>
              {TRAINING_PERIODS.map((opt) => {
                const selected = periodDraft === opt.value;
                return (
                  <li key={opt.value}>
                    <button
                      type="button"
                      className={styles.optionRow}
                      onClick={() => setPeriodDraft(opt.value)}
                    >
                      <span
                        className={`${styles.radio} ${selected ? styles.radioOn : ""}`}
                        aria-hidden="true"
                      >
                        {selected && <span className={styles.radioDot} />}
                      </span>
                      <span className={styles.optionBody}>
                        <span className={styles.optionLabel}>{opt.value}</span>
                        {opt.subtitle && (
                          <span className={styles.optionSub}>{opt.subtitle}</span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <button
              type="button"
              className={styles.sheetDone}
              onClick={() => {
                setTrainingPeriod(periodDraft);
                setPeriodSheetOpen(false);
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {showToast && (
        <Toast
          title="Employee created"
          message="They now appear in your onboarding list."
          onClose={() => setShowToast(false)}
        />
      )}
    </div>
  );
}

/* ── Inline SVG icons ── */

function ChevronLeft() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function ChevronDown({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}
