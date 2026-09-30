"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { isManager, isOwnerOrChef, submitterRoleForUser } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import { emailToUsername } from "@/lib/username";
import {
  DEFAULT_TRAINING_PERIOD,
  TRAINING_PERIODS,
  shortTrainingPeriod,
  type TrainingPeriod,
} from "@/lib/staff-training";
import Splash from "@/components/Splash";
import Toast from "@/components/Toast";
import CalendarPicker from "@/components/CalendarPicker";
import styles from "./page.module.css";

/* ──────────────────────────────────────────────────────────────────────────
 * Onboarding → Add Employee (manager view).
 * Adds a record to the `staff_onboarding` collection so the new employee
 * appears on the /people/onboarding list with a "Waiting for Documents"
 * status pill.
 *
 * The form asks only what the manager is the authority on: who the person
 * is, how to reach them, and what they are paid. Visa type, date of birth
 * and visa expiry were asked here too and were never read again — approval
 * does not copy them onto the employee record, the visa-expiry reminder
 * reads the employee's own `documents.visaExpiry`, and the birthday
 * countdown reads the date of birth they enter during /onboarding. Three
 * fields the manager had to guess at, for two facts already held elsewhere.
 *
 * The numbered sections follow the order the information arrives in, not the
 * shape of the document: the person is standing there for the first section
 * and the manager is reading off a payroll sheet by the third.
 * ────────────────────────────────────────────────────────────────────────── */

const POSITIONS = ["Hall Staff", "Kitchen Staff", "Manager", "Head Chef"] as const;
type Position = (typeof POSITIONS)[number];

/**
 * Titles a manager cannot hire into.
 *
 * Yurina raises most of the requests on this form, and the two she is left
 * with are the two she is actually filling — a floor hire. Manager and Head
 * Chef are appointments the business owner makes, and offering them in the
 * same list made them look like a choice the person filling the form gets to
 * take. The owner and the chef still see all four.
 */
const OWNER_ONLY_POSITIONS: ReadonlySet<Position> = new Set(["Manager", "Head Chef"]);

const DEFAULT_STATUS = "Waiting for Documents";
const FAR_FUTURE = "2030-12-31";
/** Earliest selectable Start Date — owner needs to back-fill hires as far
 *  back as 2022. */
const START_DATE_MIN = "2022-01-01";
const NOTES_MAX = 500;

/** Which of the three rate inputs currently has focus. One value rather than
 *  a boolean each, so the highlighted field cannot get stuck on. */
type RateField = "training" | "standard" | "saturday";

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

/** A rate the form will accept: typed, and a number. All three are required,
 *  so payroll never has to guess what an employee is owed on a Saturday. */
function isRate(raw: string): boolean {
  return raw.trim().length > 0 && !Number.isNaN(parseFloat(raw));
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
  const allowed = isOwnerOrChef(user);
  const positionOptions = useMemo<readonly Position[]>(
    () => (isManager(user) ? POSITIONS.filter((p) => !OWNER_ONLY_POSITIONS.has(p)) : POSITIONS),
    [user],
  );

  useEffect(() => {
    if (authLoading) return;
    if (!allowed) router.replace(ROUTES.home);
  }, [authLoading, allowed, router]);

  const [givenName, setGivenName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [position, setPosition] = useState<Position>("Hall Staff");
  const [startDate, setStartDate] = useState("");
  const [trainingRate, setTrainingRate] = useState("");
  const [trainingPeriod, setTrainingPeriod] = useState<TrainingPeriod>(DEFAULT_TRAINING_PERIOD);
  const [afterTrainingRate, setAfterTrainingRate] = useState("");
  const [saturdayRate, setSaturdayRate] = useState("");
  const [notes, setNotes] = useState("");

  const [focusedRate, setFocusedRate] = useState<RateField | null>(null);
  const [calOpen, setCalOpen] = useState(false);
  const [periodSheetOpen, setPeriodSheetOpen] = useState(false);
  const [periodDraft, setPeriodDraft] = useState<TrainingPeriod>(DEFAULT_TRAINING_PERIOD);

  const [saving, setSaving] = useState(false);
  const [showToast, setShowToast] = useState(false);

  // Set default start date on mount (avoids SSR/client hydration mismatch).
  useEffect(() => {
    if (!startDate) setStartDate(todayIso());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const canSave =
    givenName.trim().length > 0 &&
    familyName.trim().length > 0 &&
    mobileNumber.trim().length > 0 &&
    !!startDate &&
    isRate(trainingRate) &&
    isRate(afterTrainingRate) &&
    isRate(saturdayRate);

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
        trainingRate: parseFloat(trainingRate),
        trainingPeriod,
        afterTrainingRate: parseFloat(afterTrainingRate),
        saturdayRate: parseFloat(saturdayRate),
        notes: notes.trim(),
        status: DEFAULT_STATUS,
        role: "staff",
        requestedByUid: user?.uid ?? null,
        requestedByName: requesterDisplayName(user?.email),
        requestedByRole: submitterRoleForUser(user),
        createdAt: serverTimestamp(),
      });
      setShowToast(true);
      window.setTimeout(() => router.push("/people/onboarding"), 900);
    } catch (err) {
      // Surface the real message so the owner can tell "permission denied"
      // (Firestore rules) apart from a network error at a glance.
      console.error("[people/onboarding/new] create failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      setSaving(false);
      alert(`Failed to create employee. ${msg}`);
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
          <h1 className={styles.title}>Add Employee</h1>
        </div>
        <span className={styles.headerSpacer} />
      </header>

      <SectionHead no={1} label="Basic Information" />

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
          Please enter the correct mobile number. Their Clock In ID and the link
          to Project YURICA are sent there by SMS.
        </p>
      </div>

      <SectionHead no={2} label="Employment" />

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
            {positionOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <ChevronDown className={styles.selectChev} />
        </div>
      </div>

      {/* Start date */}
      <div className={styles.field}>
        <label className={styles.fieldLabel}>START DATE</label>
        <button
          type="button"
          className={styles.pickerBtn}
          onClick={() => setCalOpen(true)}
        >
          <CalendarIcon className={styles.pickerLeadIcon} />
          <span className={styles.pickerValue}>{fmtIsoShort(startDate)}</span>
          <ChevronDown className={styles.selectChev} />
        </button>
      </div>

      <SectionHead no={3} label="Pay Rates" />

      {/* Training rate + how long it runs for. Paired because one is
          meaningless without the other. */}
      <div className={styles.dateRow}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="trainingRate">
            TRAINING RATE <span className={styles.required}>*</span>
          </label>
          <RateInput
            id="trainingRate"
            value={trainingRate}
            onChange={setTrainingRate}
            focused={focusedRate === "training"}
            onFocus={() => setFocusedRate("training")}
            onBlur={() => setFocusedRate(null)}
          />
        </div>
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
            {/* Short form: this button shares its row with the training rate,
                which leaves it too little width for "First 2 Weeks". The sheet
                below still lists the full wording. */}
            <span className={styles.pickerValue}>{shortTrainingPeriod(trainingPeriod)}</span>
            <ChevronDown className={styles.selectChev} />
          </button>
        </div>
      </div>

      {/* What they move onto, and the weekend loading. Both required: payroll
          runs off these two numbers every week the employee is here, and a
          blank one only ever gets noticed on a payslip. */}
      <div className={styles.dateRow}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="standardRate">
            STANDARD RATE <span className={styles.required}>*</span>
          </label>
          <RateInput
            id="standardRate"
            value={afterTrainingRate}
            onChange={setAfterTrainingRate}
            focused={focusedRate === "standard"}
            onFocus={() => setFocusedRate("standard")}
            onBlur={() => setFocusedRate(null)}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="saturdayRate">
            SATURDAY RATE <span className={styles.required}>*</span>
          </label>
          <RateInput
            id="saturdayRate"
            value={saturdayRate}
            onChange={setSaturdayRate}
            focused={focusedRate === "saturday"}
            onFocus={() => setFocusedRate("saturday")}
            onBlur={() => setFocusedRate(null)}
          />
        </div>
      </div>

      <SectionHead no={4} label="Notes" />

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

      {/* Submit. The caption is here rather than in the info box above because
          it describes what the button is about to do, not what the field
          beside it is for. */}
      <p className={styles.smsNote}>SMS invite sent automatically.</p>
      <button
        type="button"
        className={styles.submitBtn}
        disabled={!canSave || saving}
        onClick={handleSave}
      >
        {saving ? "Creating…" : "Create Employee"}
      </button>

      {/* Start date bottom sheet */}
      {calOpen && (
        <div className={styles.calOverlay} onClick={() => setCalOpen(false)}>
          <div className={styles.calSheet} onClick={(e) => e.stopPropagation()}>
            <CalendarPicker
              value={startDate || todayIso()}
              minDate={START_DATE_MIN}
              maxDate={FAR_FUTURE}
              singleOnly
              onChange={(dateKey) => {
                setStartDate(dateKey);
                setCalOpen(false);
              }}
              onRangeChange={() => {}}
              onClose={() => setCalOpen(false)}
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

/**
 * A numbered divider between groups of fields.
 *
 * The form is long enough that a manager filling it on a phone loses their
 * place in it. Numbering the four groups turns one long list into four short
 * ones, and says how much is left without a progress bar that would imply
 * steps you cannot skip — every field on this page is on one screen and can
 * be filled in any order.
 */
function SectionHead({ no, label }: { no: number; label: string }) {
  return (
    <div className={styles.sectionHead}>
      <span className={styles.sectionNo} aria-hidden="true">
        {no}
      </span>
      <h2 className={styles.sectionLabel}>{label}</h2>
      <span className={styles.sectionRule} aria-hidden="true" />
    </div>
  );
}

/**
 * One "$ ⟨amount⟩ /hr" field.
 *
 * All three rates on the page share a row with something else, so this is
 * written for half width: on a 375px screen the column is about 141px, and
 * once the dollar badge and the unit have taken their share the figure is
 * left with roughly 60px. That is what "/hr" buys over "/ hour" — the
 * difference between "100.00" fitting and not.
 */
function RateInput({
  id,
  value,
  onChange,
  focused,
  onFocus,
  onBlur,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  focused: boolean;
  onFocus: () => void;
  onBlur: () => void;
}) {
  return (
    <div className={`${styles.rateWrap} ${focused ? styles.rateWrapFocused : ""}`}>
      <span
        className={`${styles.rateBadge} ${focused ? styles.rateBadgeOn : ""}`}
        aria-hidden="true"
      >
        $
      </span>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={0}
        step="0.01"
        className={styles.rateInput}
        placeholder="0.00"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
      />
      <span className={styles.rateSuffix}>/hr</span>
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
