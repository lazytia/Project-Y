"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  addDoc,
  collection,
  serverTimestamp,
} from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { getDb, getStorage } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { isOwner } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import { emailToUsername } from "@/lib/username";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

/* ──────────────────────────────────────────────────────────────────────
 * New Cash Payment → Trial Shift (Candidate). Two-step flow:
 *   1. Candidate Details / ID Verification / Trial Details / Outcome
 *   2. Payment Method / Amount / Declaration & Signature
 * Saves the full record to Firestore (cash_payments).
 * ──────────────────────────────────────────────────────────────────── */

const ID_TYPES = ["Driver Licence", "Passport", "Photo Card", "Other"] as const;
const POSITIONS = ["Hall Staff", "Kitchen Staff", "Barista", "Other"] as const;
type Outcome = "not-hired" | "future-consideration" | "hired";

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function fmtIsoLong(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", {
    day: "numeric", month: "short", year: "numeric",
  });
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

async function uploadDataUrl(dataUrl: string, folder: string): Promise<string> {
  // Convert data URL → Blob.
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const rand = Math.random().toString(36).slice(2, 10);
  const path = `cash_payments/${folder}/${Date.now()}_${rand}.jpg`;
  const ref = storageRef(getStorage(), path);
  await uploadBytes(ref, blob, { contentType: blob.type || "image/jpeg" });
  return await getDownloadURL(ref);
}

export default function TrialShiftPaymentPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwner(user);

  useEffect(() => {
    if (authLoading) return;
    if (!allowed) router.replace(ROUTES.home);
  }, [authLoading, allowed, router]);

  // Step state
  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 — Candidate
  const [fullName, setFullName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");

  // Step 1 — ID Verification
  const [idType, setIdType] = useState<typeof ID_TYPES[number]>("Driver Licence");
  const [idPhotoDataUrl, setIdPhotoDataUrl] = useState<string>("");

  // Step 1 — Trial Details
  const [date, setDate] = useState(todayIso());
  const [startTime, setStartTime] = useState("11:00");
  const [finishTime, setFinishTime] = useState("14:00");
  const [position, setPosition] = useState<typeof POSITIONS[number]>("Hall Staff");
  const [ratePerHour, setRatePerHour] = useState<string>("25");

  // Step 1 — Outcome
  const [outcome, setOutcome] = useState<Outcome>("not-hired");

  const hoursWorked = useMemo(() => hoursBetween(startTime, finishTime), [startTime, finishTime]);
  const totalAmount = useMemo(() => {
    const rate = parseFloat(ratePerHour) || 0;
    return +(hoursWorked * rate).toFixed(2);
  }, [hoursWorked, ratePerHour]);

  const canGoStep2 =
    fullName.trim().length > 0 &&
    mobile.trim().length > 0 &&
    !!idPhotoDataUrl &&
    !!date &&
    hoursWorked > 0 &&
    totalAmount > 0;

  // Step 2 — Payment
  const [paymentMethod, setPaymentMethod] = useState<"Cash">("Cash");
  const [notes, setNotes] = useState("");

  // Step 2 — Signature
  const sigCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sigDrawing = useRef(false);
  const sigLast = useRef<{ x: number; y: number } | null>(null);
  const [hasSignature, setHasSignature] = useState(false);
  const [saving, setSaving] = useState(false);

  function resetCanvas() {
    const c = sigCanvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
  }

  useEffect(() => {
    if (step !== 2) return;
    const c = sigCanvasRef.current;
    if (!c) return;
    // Match canvas backing size to its CSS box for crisp drawing.
    const rect = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.floor(rect.width * dpr);
    c.height = Math.floor(rect.height * dpr);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111";
    resetCanvas();
  }, [step]);

  function canvasPos(ev: PointerEvent | React.PointerEvent): { x: number; y: number } {
    const c = sigCanvasRef.current!;
    const rect = c.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  function onSigDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    sigDrawing.current = true;
    sigLast.current = canvasPos(e);
  }
  function onSigMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!sigDrawing.current) return;
    const c = sigCanvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const p = canvasPos(e);
    if (sigLast.current) {
      ctx.beginPath();
      ctx.moveTo(sigLast.current.x, sigLast.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    sigLast.current = p;
    setHasSignature(true);
  }
  function onSigUp(e: React.PointerEvent<HTMLCanvasElement>) {
    sigDrawing.current = false;
    sigLast.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }
  function clearSignature() {
    resetCanvas();
    setHasSignature(false);
  }

  async function handleConfirm() {
    if (!user || saving || !hasSignature) return;
    setSaving(true);
    try {
      const idPhotoUrl = idPhotoDataUrl ? await uploadDataUrl(idPhotoDataUrl, "ids") : "";
      // Signature → data URL → upload
      const sigDataUrl = sigCanvasRef.current?.toDataURL("image/png") ?? "";
      const signatureUrl = sigDataUrl ? await uploadDataUrl(sigDataUrl, "signatures") : "";

      const createdByName =
        emailToUsername(user.email ?? "").charAt(0).toUpperCase() +
        emailToUsername(user.email ?? "").slice(1);

      await addDoc(collection(getDb(), "cash_payments"), {
        type: "trial-shift",
        reason: "Trial Shift",
        recipientName: fullName.trim(),
        recipientMobile: mobile.trim(),
        recipientEmail: email.trim() || null,
        idType,
        idPhotoUrl,
        trial: {
          date,
          startTime,
          finishTime,
          hoursWorked,
          position,
          ratePerHour: parseFloat(ratePerHour) || 0,
        },
        outcome,
        paymentMethod,
        amount: totalAmount,
        notes: notes.trim() || null,
        signatureUrl,
        signed: true,
        paidAt: date ? new Date(`${date}T12:00:00`) : new Date(),
        createdAt: serverTimestamp(),
        createdByUid: user.uid,
        createdByName,
      });

      router.push("/people/cash-payments");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save payment.");
      setSaving(false);
    }
  }

  if (authLoading) return <Splash />;
  if (!allowed) return null;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => (step === 2 ? setStep(1) : router.push("/people/cash-payments/new"))}
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
        <div className={`${styles.step} ${step === 1 ? styles.stepActive : styles.stepDone}`}>
          <span className={styles.stepBubble}>
            {step === 1 ? "1" : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </span>
          <span className={styles.stepLabel}>Details</span>
        </div>
        <span className={styles.stepLine} />
        <div className={`${styles.step} ${step === 2 ? styles.stepActive : styles.stepPending}`}>
          <span className={styles.stepBubble}>2</span>
          <span className={styles.stepLabel}>Payment &amp; Signature</span>
        </div>
      </div>

      {step === 1 && (
        <>
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
                onChange={(e) => setIdType(e.target.value as typeof ID_TYPES[number])}
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
                <select className={styles.input} value={position} onChange={(e) => setPosition(e.target.value as typeof POSITIONS[number])}>
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
            disabled={!canGoStep2}
            onClick={() => setStep(2)}
          >
            Next: Payment &amp; Signature
            <span className={styles.btnChev} aria-hidden="true">›</span>
          </button>
        </>
      )}

      {step === 2 && (
        <>
          {/* 5. Payment Details */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>5. Payment Details</h2>
            <Field label="Payment Method" required>
              <select
                className={styles.input}
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as "Cash")}
              >
                <option value="Cash">Cash</option>
              </select>
            </Field>

            <div className={styles.amountCard}>
              <p className={styles.amountLabel}>Amount Paid <span className={styles.requiredMark}>*</span></p>
              <p className={styles.amountValue}>{fmtCurrency(totalAmount)}</p>
              <div className={styles.amountIcon} aria-hidden="true">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="5" y="3" width="14" height="18" rx="2" />
                  <line x1="12" y1="8" x2="12" y2="16" />
                  <path d="M14.5 10.5a2 2 0 0 0-2-2h-1a1.5 1.5 0 0 0 0 3h1a1.5 1.5 0 0 1 0 3h-1a2 2 0 0 1-2-2" />
                </svg>
              </div>
              <p className={styles.amountFoot}>Cash payment given on</p>
              <p className={styles.amountDate}>{fmtIsoLong(date)}</p>
            </div>

            <Field label="Notes" optional>
              <textarea
                className={styles.textarea}
                placeholder="e.g. Trial shift for Hall Staff position."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                maxLength={500}
              />
            </Field>
          </section>

          {/* 6. Declaration & Signature */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>
              6. Declaration &amp; Signature <span className={styles.essential}>Essential</span>
            </h2>
            <div className={styles.declaration}>
              <span className={styles.declarationIcon} aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <polyline points="9 12 11 14 15 10" />
                </svg>
              </span>
              <p className={styles.declarationTitle}>Declaration</p>
              <p className={styles.declarationBody}>
                I confirm that I have received <strong>{fmtCurrency(totalAmount)}</strong> cash payment
                for my trial shift at <strong>YURICA Japanese Kitchen</strong> on{" "}
                <strong>{fmtIsoLong(date)}</strong>.
              </p>
            </div>

            <Field label="Signature" required>
              <div className={styles.signatureWrap}>
                <canvas
                  ref={sigCanvasRef}
                  className={styles.signatureCanvas}
                  onPointerDown={onSigDown}
                  onPointerMove={onSigMove}
                  onPointerUp={onSigUp}
                  onPointerCancel={onSigUp}
                />
                {!hasSignature && (
                  <span className={styles.signaturePlaceholder}>Please sign here</span>
                )}
                <button type="button" className={styles.clearBtn} onClick={clearSignature}>
                  Clear
                </button>
              </div>
            </Field>
          </section>

          <button
            type="button"
            className={styles.primaryBtn}
            disabled={!hasSignature || saving}
            onClick={handleConfirm}
          >
            {saving ? "Saving…" : "Confirm Payment"}
          </button>
          <p className={styles.lockHint}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            Once saved, this record cannot be edited.
          </p>
        </>
      )}
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
