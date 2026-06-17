"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { isOwner } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import Splash from "@/components/Splash";
import styles from "./page.module.css";
import {
  ID_TYPES,
  POSITIONS,
  TRIAL_DRAFT_KEY,
  type IdType,
  type Outcome,
  type Position,
  type TrialShiftDraft,
} from "./draft";

/* ──────────────────────────────────────────────────────────────────────
 * New Cash Payment → Trial Shift (Candidate) — Step 1 of 2.
 * Captures candidate details, ID, trial details and outcome, then
 * stashes them in sessionStorage and navigates to the payment step.
 * ──────────────────────────────────────────────────────────────────── */

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function hoursBetween(start: string, end: string): number {
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const mins = (eh * 60 + em) - (sh * 60 + sm);
  return mins > 0 ? +(mins / 60).toFixed(2) : 0;
}

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency", currency: "AUD",
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n);
}

async function compressImageToDataUrl(file: File): Promise<string> {
  const MAX_DIM = 1600;
  const QUALITY = 0.82;
  const dataUrl: string = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => (typeof r.result === "string" ? resolve(r.result) : reject(new Error("read failed")));
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(file);
  });
  const img: HTMLImageElement = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("img load failed"));
    i.src = dataUrl;
  });
  const ratio = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * ratio));
  const h = Math.max(1, Math.round(img.height * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas not supported");
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", QUALITY);
}

export default function TrialShiftDetailsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwner(user);

  useEffect(() => {
    if (authLoading) return;
    if (!allowed) router.replace(ROUTES.home);
  }, [authLoading, allowed, router]);

  // Form state
  const [fullName, setFullName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [idType, setIdType] = useState<IdType>("Driver Licence");
  const [idPhotoDataUrl, setIdPhotoDataUrl] = useState("");
  const [date, setDate] = useState(todayIso());
  const [startTime, setStartTime] = useState("11:00");
  const [finishTime, setFinishTime] = useState("14:00");
  const [position, setPosition] = useState<Position>("Hall Staff");
  const [ratePerHour, setRatePerHour] = useState("25");
  const [outcome, setOutcome] = useState<Outcome>("not-hired");

  // Hydrate from sessionStorage if the user came back from step 2.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem(TRIAL_DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as Partial<TrialShiftDraft>;
      if (typeof d.fullName === "string") setFullName(d.fullName);
      if (typeof d.mobile === "string") setMobile(d.mobile);
      if (typeof d.email === "string") setEmail(d.email);
      if (d.idType && ID_TYPES.includes(d.idType)) setIdType(d.idType);
      if (typeof d.idPhotoDataUrl === "string") setIdPhotoDataUrl(d.idPhotoDataUrl);
      if (typeof d.date === "string") setDate(d.date);
      if (typeof d.startTime === "string") setStartTime(d.startTime);
      if (typeof d.finishTime === "string") setFinishTime(d.finishTime);
      if (d.position && POSITIONS.includes(d.position)) setPosition(d.position);
      if (typeof d.ratePerHour === "string") setRatePerHour(d.ratePerHour);
      if (d.outcome === "not-hired" || d.outcome === "future-consideration" || d.outcome === "hired") {
        setOutcome(d.outcome);
      }
    } catch { /* ignore */ }
  }, []);

  const hoursWorked = useMemo(() => hoursBetween(startTime, finishTime), [startTime, finishTime]);
  const totalAmount = useMemo(() => {
    const rate = parseFloat(ratePerHour) || 0;
    return +(hoursWorked * rate).toFixed(2);
  }, [hoursWorked, ratePerHour]);

  const canContinue =
    fullName.trim().length > 0 &&
    mobile.trim().length > 0 &&
    !!idPhotoDataUrl &&
    !!date &&
    hoursWorked > 0 &&
    totalAmount > 0;

  function handleNext() {
    if (!canContinue) return;
    const draft: TrialShiftDraft = {
      fullName: fullName.trim(),
      mobile: mobile.trim(),
      email: email.trim(),
      idType,
      idPhotoDataUrl,
      date,
      startTime,
      finishTime,
      position,
      ratePerHour,
      hoursWorked,
      totalAmount,
      outcome,
    };
    try {
      window.sessionStorage.setItem(TRIAL_DRAFT_KEY, JSON.stringify(draft));
    } catch {
      alert("Could not save draft — your browser may be out of storage.");
      return;
    }
    router.push("/people/cash-payments/new/trial-shift/payment");
  }

  if (authLoading) return <Splash />;
  if (!allowed) return null;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => router.push("/people/cash-payments/new")}
          aria-label="Back"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className={styles.title}>Trial Shift Payment</h1>
        <span />
      </header>

      {/* Stepper */}
      <div className={styles.stepper}>
        <div className={`${styles.step} ${styles.stepActive}`}>
          <span className={styles.stepBubble}>1</span>
          <span className={styles.stepLabel}>Details</span>
        </div>
        <span className={styles.stepLine} />
        <div className={`${styles.step} ${styles.stepPending}`}>
          <span className={styles.stepBubble}>2</span>
          <span className={styles.stepLabel}>Payment &amp; Signature</span>
        </div>
      </div>

      {/* 1. Candidate */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>1. Candidate Details</h2>
        <Field label="Full Name" required>
          <input
            type="text"
            className={styles.input}
            placeholder="e.g. James Kim"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            maxLength={80}
          />
        </Field>
        <Field label="Mobile Number" required>
          <input
            type="tel"
            className={styles.input}
            placeholder="0400 123 456"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            maxLength={32}
          />
        </Field>
        <Field label="Email" optional>
          <input
            type="email"
            className={styles.input}
            placeholder="name@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={120}
          />
        </Field>
      </section>

      {/* 2. ID Verification */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          2. ID Verification <span className={styles.essential}>Essential</span>
        </h2>
        <Field label="ID Type" required>
          <select
            className={styles.input}
            value={idType}
            onChange={(e) => setIdType(e.target.value as IdType)}
          >
            {ID_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Upload Photo ID" required>
          <label className={styles.uploadBox}>
            <input
              type="file"
              accept="image/*"
              className={styles.hiddenFile}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  const url = await compressImageToDataUrl(f);
                  setIdPhotoDataUrl(url);
                } catch (err) {
                  alert(err instanceof Error ? err.message : "Could not process image.");
                } finally {
                  e.target.value = "";
                }
              }}
            />
            {idPhotoDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={idPhotoDataUrl} alt="ID preview" className={styles.uploadPreview} />
            ) : (
              <>
                <span className={styles.uploadIcon} aria-hidden="true">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="6" width="18" height="12" rx="2" />
                    <circle cx="9" cy="12" r="2" />
                    <line x1="14" y1="10" x2="19" y2="10" />
                    <line x1="14" y1="14" x2="19" y2="14" />
                  </svg>
                  <span className={styles.uploadPlus}>+</span>
                </span>
                <span className={styles.uploadLabel}>Upload front of ID</span>
                <span className={styles.uploadHint}>JPG, PNG or PDF</span>
              </>
            )}
          </label>
        </Field>
      </section>

      {/* 3. Trial Details */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>3. Trial Details</h2>
        <div className={styles.gridTwo}>
          <Field label="Date" required>
            <input type="date" className={styles.input} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Start Time" required>
            <input type="time" className={styles.input} value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </Field>
          <Field label="Finish Time" required>
            <input type="time" className={styles.input} value={finishTime} onChange={(e) => setFinishTime(e.target.value)} />
          </Field>
          <Field label="Hours Worked">
            <input type="text" className={styles.input} value={`${hoursWorked} hrs`} readOnly />
          </Field>
          <Field label="Position" required>
            <select className={styles.input} value={position} onChange={(e) => setPosition(e.target.value as Position)}>
              {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Rate (per hour)" required>
            <div className={styles.prefixWrap}>
              <span className={styles.prefix}>$</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                className={`${styles.input} ${styles.prefixedInput}`}
                value={ratePerHour}
                onChange={(e) => setRatePerHour(e.target.value)}
              />
            </div>
          </Field>
        </div>
        <div className={styles.totalBox}>
          <p className={styles.totalLabel}>Total Amount</p>
          <p className={styles.totalValue}>{fmtCurrency(totalAmount)}</p>
        </div>
      </section>

      {/* 4. Outcome */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>4. Outcome</h2>
        <ul className={styles.radioList}>
          {([
            { v: "not-hired", label: "Not Hired" },
            { v: "future-consideration", label: "Future Consideration" },
            { v: "hired", label: "Hired" },
          ] as { v: Outcome; label: string }[]).map((o) => (
            <li key={o.v}>
              <label className={`${styles.radioRow} ${outcome === o.v ? styles.radioRowOn : ""}`}>
                <input
                  type="radio"
                  name="outcome"
                  className={styles.radioInput}
                  checked={outcome === o.v}
                  onChange={() => setOutcome(o.v)}
                />
                <span className={`${styles.radioDot} ${outcome === o.v ? styles.radioDotOn : ""}`} />
                <span className={styles.radioLabel}>{o.label}</span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <button
        type="button"
        className={styles.primaryBtn}
        disabled={!canContinue}
        onClick={handleNext}
      >
        Next: Payment &amp; Signature
        <span className={styles.btnChev} aria-hidden="true">›</span>
      </button>
    </div>
  );
}

function Field({
  label,
  required,
  optional,
  children,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel}>
        {label}
        {required && <span className={styles.requiredMark}> *</span>}
        {optional && <span className={styles.optionalMark}> (Optional)</span>}
      </label>
      {children}
    </div>
  );
}
