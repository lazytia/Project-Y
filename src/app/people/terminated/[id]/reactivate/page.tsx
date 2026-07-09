"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { deleteField, doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { isOwner, isChef } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import {
  fmtDateWithDay,
  fmtDateWithDayFromTs,
  fullNameOf,
  initialsOf,
  positionLabelOf,
  todayIso,
  tsToDate,
} from "@/lib/staff-display";
import CalendarPicker from "@/components/CalendarPicker";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

const POSITIONS = ["Hall Staff", "Kitchen Staff", "Hall Manager", "Chef"] as const;
const VISA_TYPES = ["Student", "Residence", "Working Holiday"] as const;
const EMPLOYMENT_TYPES = ["Casual", "Part-time", "Full-time"] as const;
const LOCATIONS = ["Hall", "Kitchen"] as const;
const NOTE_MAX = 200;

type StaffPreview = {
  uid: string;
  name: string;
  positionLabel: string;
  rate: number | null;
  terminatedAt: Date | null;
  lastWorkingDate: string;
  noticeGivenDate: string;
  terminationReason: string;
  rehireEligible: string;
  managerNotes: string;
  terminatedByName: string;
};

export default function ReactivateEmployeePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwner(user) || isChef(user);

  const [staff, setStaff] = useState<StaffPreview | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);

  const [rehireDate, setRehireDate] = useState(todayIso());
  const [position, setPosition] = useState<string>(POSITIONS[0]);
  const [visaType, setVisaType] = useState<string>(VISA_TYPES[0]);
  const [employmentType, setEmploymentType] = useState<string>(EMPLOYMENT_TYPES[0]);
  const [rate, setRate] = useState("");
  const [workLocation, setWorkLocation] = useState<string>(LOCATIONS[0]);
  const [notes, setNotes] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [calOpen, setCalOpen] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!allowed) router.replace(ROUTES.home);
  }, [allowed, authLoading, router]);

  useEffect(() => {
    if (!allowed) return;
    const id = params?.id;
    if (!id) return;
    let cancelled = false;

    (async () => {
      try {
        const snap = await getDoc(doc(getDb(), "staff_onboarding", id));
        if (!snap.exists()) {
          if (!cancelled) setNotFound(true);
          return;
        }
        const raw = snap.data() as Record<string, unknown>;
        if (String(raw.status ?? "").toLowerCase() !== "terminated") {
          router.replace(`/people/active/${id}`);
          return;
        }
        const pos = positionLabelOf(raw);
        const rateVal =
          typeof raw.afterTrainingRate === "number"
            ? raw.afterTrainingRate
            : typeof raw.trainingRate === "number"
              ? raw.trainingRate
              : null;

        if (!cancelled) {
          setStaff({
            uid: snap.id,
            name: fullNameOf(raw),
            positionLabel: pos,
            rate: rateVal,
            terminatedAt: tsToDate(raw.terminatedAt),
            lastWorkingDate: typeof raw.lastWorkingDate === "string" ? raw.lastWorkingDate : "",
            noticeGivenDate: typeof raw.noticeGivenDate === "string" ? raw.noticeGivenDate : "",
            terminationReason:
              typeof raw.terminationReason === "string" ? raw.terminationReason : "",
            rehireEligible: typeof raw.rehireEligible === "string" ? raw.rehireEligible : "",
            managerNotes:
              typeof raw.terminationManagerNotes === "string"
                ? raw.terminationManagerNotes
                : "",
            terminatedByName:
              typeof raw.terminatedByName === "string" ? raw.terminatedByName : "",
          });
          setPosition(pos);
          const existingVisa =
            typeof raw.visaType === "string" && raw.visaType.trim()
              ? raw.visaType.trim()
              : typeof raw.visa === "string" && raw.visa.trim()
                ? raw.visa.trim()
                : VISA_TYPES[0];
          setVisaType(
            (VISA_TYPES as readonly string[]).includes(existingVisa)
              ? existingVisa
              : VISA_TYPES[0],
          );
          setWorkLocation(pos.toLowerCase().includes("kitchen") ? "Kitchen" : "Hall");
          if (rateVal !== null) setRate(rateVal.toFixed(2));
        }
      } catch {
        if (!cancelled) setNotFound(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [allowed, params?.id, router]);

  const canSubmit = useMemo(() => {
    const parsed = parseFloat(rate);
    return (
      !!rehireDate &&
      !!position &&
      !!visaType &&
      !!employmentType &&
      !!workLocation &&
      !Number.isNaN(parsed) &&
      parsed > 0 &&
      confirmed &&
      !saving
    );
  }, [rehireDate, position, visaType, employmentType, workLocation, rate, confirmed, saving]);

  async function handleReactivate() {
    if (!staff || !canSubmit) return;
    setSaving(true);
    try {
      const parsedRate = parseFloat(rate);
      const reactivatedByName =
        user?.displayName?.trim() ||
        (user?.email ? user.email.split("@")[0] : "Owner");

      const previousTermination = {
        lastWorkingDate: staff.lastWorkingDate,
        noticeGivenDate: staff.noticeGivenDate,
        terminationReason: staff.terminationReason,
        rehireEligible: staff.rehireEligible,
        managerNotes: staff.managerNotes,
        terminatedByName: staff.terminatedByName,
        terminatedAt: staff.terminatedAt
          ? `${staff.terminatedAt.getFullYear()}-${String(staff.terminatedAt.getMonth() + 1).padStart(2, "0")}-${String(staff.terminatedAt.getDate()).padStart(2, "0")}`
          : "",
      };

      await setDoc(
        doc(getDb(), "staff_onboarding", staff.uid),
        {
          status: "active",
          position,
          visaType,
          employmentType,
          workLocation,
          afterTrainingRate: parsedRate,
          trainingRate: parsedRate,
          rehireDate,
          reactivationNotes: notes.trim(),
          reactivatedAt: serverTimestamp(),
          reactivatedByName,
          previousTermination,
          terminatedAt: deleteField(),
          lastWorkingDate: deleteField(),
          terminationReason: deleteField(),
          reasonForLeaving: deleteField(),
          reasonForLeavingOther: deleteField(),
          noticeGivenDate: deleteField(),
          rehireEligible: deleteField(),
          terminationManagerNotes: deleteField(),
          terminatedByName: deleteField(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      router.push("/people/active");
    } catch (err) {
      console.error("[reactivate] failed:", err);
      alert("Failed to reactivate. Please try again.");
      setSaving(false);
    }
  }

  if (authLoading || !allowed) return <Splash />;
  if (notFound) {
    return (
      <div className={styles.page}>
        <BackButton onClick={() => router.back()} />
        <p className={styles.notFound}>Employee not found.</p>
      </div>
    );
  }
  if (!staff) return <Splash label="Loading…" />;

  const terminatedOn = staff.terminatedAt ? fmtDateWithDayFromTs(staff.terminatedAt) : "—";

  return (
    <div className={styles.page}>
      <BackButton
        onClick={() => router.push(`/people/terminated/${staff.uid}`)}
      />

      <header className={styles.intro}>
        <h1 className={styles.pageTitle}>Reactivate Employee</h1>
        <p className={styles.pageDesc}>Provide the details below to reactivate this employee.</p>
      </header>

      <section className={styles.summaryCard}>
        <div className={styles.avatar}>{initialsOf(staff.name)}</div>
        <div className={styles.summaryMain}>
          <p className={styles.summaryName}>{staff.name}</p>
          <p className={styles.summaryPos}>{staff.positionLabel}</p>
          <span className={styles.terminatedPill}>
            <span className={styles.terminatedDot} aria-hidden="true" />
            Terminated
          </span>
        </div>
        <div className={styles.summaryMeta}>
          <p className={styles.summaryMetaLabel}>Terminated on</p>
          <p className={styles.summaryMetaDate}>{terminatedOn}</p>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Reactivation Details</h2>

        <div className={styles.field}>
          <label className={styles.fieldLabel}>
            Rehire Date <span className={styles.required}>*</span>
          </label>
          <button type="button" className={styles.dateBtn} onClick={() => setCalOpen(true)}>
            <CalendarIcon />
            {fmtDateWithDay(rehireDate)}
          </button>
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel}>
            Position <span className={styles.required}>*</span>
          </label>
          <select className={styles.select} value={position} onChange={(e) => setPosition(e.target.value)}>
            {POSITIONS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel}>
            Visa Type <span className={styles.required}>*</span>
          </label>
          <select className={styles.select} value={visaType} onChange={(e) => setVisaType(e.target.value)}>
            {VISA_TYPES.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel}>
            Employment Type <span className={styles.required}>*</span>
          </label>
          <select
            className={styles.select}
            value={employmentType}
            onChange={(e) => setEmploymentType(e.target.value)}
          >
            {EMPLOYMENT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel}>
            Rate <span className={styles.required}>*</span>
          </label>
          <div className={styles.rateRow}>
            <input
              type="number"
              className={styles.rateInput}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              min="0"
              step="0.01"
            />
            <span className={styles.rateSuffix}>per hour</span>
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel}>
            Work Location <span className={styles.required}>*</span>
          </label>
          <select
            className={styles.select}
            value={workLocation}
            onChange={(e) => setWorkLocation(e.target.value)}
          >
            {LOCATIONS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel}>Notes</label>
          <textarea
            className={styles.textarea}
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, NOTE_MAX))}
            placeholder="Add a note (optional)"
          />
          <p className={styles.charCount}>{notes.length}/{NOTE_MAX}</p>
        </div>
      </section>

      <div className={styles.infoBox}>
        <InfoIcon />
        <p className={styles.infoText}>
          Documents from the previous employment will be retained. You can upload new
          documents if needed.
        </p>
      </div>

      <section className={styles.confirmSection}>
        <p className={styles.confirmLabel}>CONFIRMATION</p>
        <label className={styles.checkRow}>
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span className={styles.checkText}>
            I confirm that the employee is reactivated in the system.
          </span>
        </label>
      </section>

      <div className={styles.bottomBar}>
        <div className={styles.bottomInner}>
          <button
            type="button"
            className={styles.cancelBtn}
            onClick={() => router.back()}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.submitBtn}
            onClick={handleReactivate}
            disabled={!canSubmit}
          >
            {saving ? "Saving…" : "Reactivate Employee"}
          </button>
        </div>
      </div>

      {calOpen && (
        <div className={styles.calOverlay} onClick={() => setCalOpen(false)}>
          <div className={styles.calSheet} onClick={(e) => e.stopPropagation()}>
            <CalendarPicker
              value={rehireDate}
              maxDate="2030-12-31"
              minDate={todayIso()}
              singleOnly
              onChange={(dateKey) => {
                setRehireDate(dateKey);
                setCalOpen(false);
              }}
              onRangeChange={() => {}}
              onClose={() => setCalOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className={styles.backBtn} onClick={onClick} aria-label="Back">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="15 18 9 12 15 6" />
      </svg>
      Back
    </button>
  );
}

function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}
