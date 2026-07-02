"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  type Timestamp,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { isOwner } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import Splash from "@/components/Splash";
import Toast from "@/components/Toast";
import CalendarPicker from "@/components/CalendarPicker";
import styles from "./ManagerEditForm.module.css";

/* ──────────────────────────────────────────────────────────────────────────
 * Onboarding → Edit Employee (manager view).
 * Pre-fills from the `staff_onboarding/{id}` Firestore document and allows
 * the manager to update or delete the record.
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

const FAR_FUTURE = "2030-12-31";
const NOTES_MAX = 500;

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
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

function toIso(v: unknown): string {
  if (!v) return todayIso();
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    const parsed = new Date(v);
    if (!Number.isNaN(parsed.getTime())) {
      return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
    }
    return todayIso();
  }
  if (typeof v === "object" && v !== null && "toDate" in v) {
    try {
      const d = (v as Timestamp).toDate();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    } catch {
      return todayIso();
    }
  }
  return todayIso();
}

function normalisePosition(raw: unknown): Position {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "kitchen" || s === "kitchen_staff" || s === "kitchen staff")
    return "Kitchen Staff";
  return "Hall Staff";
}

function normaliseTrainingPeriod(raw: unknown): TrainingPeriod {
  const s = String(raw ?? "").trim();
  if (s === "First 3 Weeks") return "First 3 Weeks";
  if (s === "Until Fully Trained") return "Until Fully Trained";
  return "First 2 Weeks";
}

export default function ManagerEditForm() {
  const router = useRouter();
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : (params.id?.[0] ?? "");

  const { user, loading: authLoading } = useAuth();
  const allowed = isOwner(user);

  useEffect(() => {
    if (authLoading) return;
    if (!allowed) router.replace(ROUTES.home);
  }, [authLoading, allowed, router]);

  const [loadingDoc, setLoadingDoc] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [fullName, setFullName] = useState("");
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
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toast, setToast] = useState<{ title: string; message: string } | null>(null);

  // Load existing document
  useEffect(() => {
    if (!allowed || !id) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(getDb(), "staff_onboarding", id));
        if (cancelled) return;
        if (!snap.exists()) {
          setNotFound(true);
          setLoadingDoc(false);
          return;
        }
        const raw = snap.data() as Record<string, unknown>;
        setFullName((raw.fullName as string | undefined) ?? "");
        setMobileNumber((raw.mobileNumber as string | undefined) ?? "");
        setPosition(normalisePosition(raw.position));
        setStartDate(toIso(raw.startDate));
        if (raw.documents && typeof raw.documents === "object") {
          const docs = raw.documents as Record<string, unknown>;
          if (docs.visaExpiry) setVisaExpiry(toIso(docs.visaExpiry));
        }
        if (raw.visaExpiry) setVisaExpiry(toIso(raw.visaExpiry));
        setTrainingRate(
          typeof raw.trainingRate === "number" ? String(raw.trainingRate) : "",
        );
        setTrainingPeriod(normaliseTrainingPeriod(raw.trainingPeriod));
        setAfterTrainingRate(
          typeof raw.afterTrainingRate === "number"
            ? String(raw.afterTrainingRate)
            : "",
        );
        setNotes((raw.notes as string | undefined) ?? "");
        setLoadingDoc(false);
      } catch {
        if (!cancelled) setLoadingDoc(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allowed, id]);

  const canSave =
    fullName.trim().length > 0 &&
    !!startDate &&
    !!trainingRate.trim() &&
    !Number.isNaN(parseFloat(trainingRate));

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await updateDoc(doc(getDb(), "staff_onboarding", id), {
        fullName: fullName.trim(),
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
        updatedAt: serverTimestamp(),
      });
      setToast({ title: "Changes saved", message: "Employee record has been updated." });
      window.setTimeout(() => router.push("/people/onboarding"), 900);
    } catch {
      setSaving(false);
      alert("Failed to save changes. Please try again.");
    }
  }

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(getDb(), "staff_onboarding", id));
      setConfirmDelete(false);
      setToast({ title: "Employee removed", message: "The onboarding record has been deleted." });
      window.setTimeout(() => router.push("/people/onboarding"), 900);
    } catch {
      setDeleting(false);
      alert("Failed to delete employee. Please try again.");
    }
  }

  if (authLoading) return <Splash />;
  if (!allowed) return null;
  if (loadingDoc) return <Splash />;

  if (notFound) {
    return (
      <div className={styles.page}>
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
            <h1 className={styles.title}>Not Found</h1>
          </div>
          <span className={styles.headerSpacer} />
        </header>
        <p className={styles.notFoundMsg}>This employee record no longer exists.</p>
      </div>
    );
  }

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
          <h1 className={styles.title}>Edit Employee</h1>
        </div>
        <span className={styles.headerSpacer} />
      </header>

      {/* Full name */}
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="fullName">
          FULL NAME
        </label>
        <input
          id="fullName"
          type="text"
          className={styles.input}
          placeholder="e.g. Sakura Tanaka"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          maxLength={80}
        />
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

      {/* Save */}
      <button
        type="button"
        className={styles.submitBtn}
        disabled={!canSave || saving}
        onClick={handleSave}
      >
        {saving ? "Saving…" : "Save Changes"}
      </button>

      {/* Delete */}
      {!confirmDelete ? (
        <button
          type="button"
          className={styles.deleteBtn}
          onClick={() => setConfirmDelete(true)}
        >
          Delete Employee
        </button>
      ) : (
        <div className={styles.confirmWrap}>
          <p className={styles.confirmText}>
            Are you sure? This will permanently remove the onboarding record.
          </p>
          <div className={styles.confirmRow}>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.confirmDeleteBtn}
              disabled={deleting}
              onClick={handleDelete}
            >
              {deleting ? "Deleting…" : "Yes, Delete"}
            </button>
          </div>
        </div>
      )}

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

      {toast && (
        <Toast
          title={toast.title}
          message={toast.message}
          onClose={() => setToast(null)}
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
