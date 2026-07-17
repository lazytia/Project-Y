"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { getDb } from "@/lib/firebase";
import { getStorage } from "@/lib/firebase-storage";
import { useAuth } from "@/components/AuthProvider";
import { isOwnerOrChef } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import { emailToUsername } from "@/lib/username";
import Splash from "@/components/Splash";
import styles from "../page.module.css";
import { TRIAL_DRAFT_KEY, type TrialShiftDraft } from "../draft";

/* ──────────────────────────────────────────────────────────────────────
 * New Cash Payment → Trial Shift (Candidate) — Step 2 of 2.
 * Reads the draft from sessionStorage, captures Payment + Signature
 * and writes the final cash_payments doc.
 * ──────────────────────────────────────────────────────────────────── */

function fmtIsoLong(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency", currency: "AUD",
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n);
}

async function uploadDataUrl(dataUrl: string, folder: string): Promise<string> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const rand = Math.random().toString(36).slice(2, 10);
  const path = `cash_payments/${folder}/${Date.now()}_${rand}.jpg`;
  const ref = storageRef(getStorage(), path);
  await uploadBytes(ref, blob, { contentType: blob.type || "image/jpeg" });
  return await getDownloadURL(ref);
}

export default function TrialShiftPaymentStepPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwnerOrChef(user);

  const [draft, setDraft] = useState<TrialShiftDraft | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!allowed) { router.replace(ROUTES.home); return; }
    try {
      const raw = window.sessionStorage.getItem(TRIAL_DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw) as TrialShiftDraft;
        setDraft(d);
      } else {
        // No draft → kick back to step 1.
        router.replace("/people/cash-payments/new/trial-shift");
        return;
      }
    } catch {
      router.replace("/people/cash-payments/new/trial-shift");
      return;
    } finally {
      setHydrated(true);
    }
  }, [authLoading, allowed, router]);

  // Step 2 sub-steps: 1 = Payment Details, 2 = Declaration & Signature
  const [subStep, setSubStep] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState<"Cash">("Cash");
  const [notes, setNotes] = useState("");

  // Signature
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
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.restore();
  }

  useEffect(() => {
    if (!draft) return;
    const c = sigCanvasRef.current;
    if (!c) return;
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
  }, [draft]);

  function canvasPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = sigCanvasRef.current!;
    const rect = c.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
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
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }
  function clearSignature() {
    resetCanvas();
    setHasSignature(false);
  }

  async function handleConfirm() {
    if (!user || !draft || saving || !hasSignature) return;
    setSaving(true);
    try {
      const idPhotoUrl = draft.idPhotoDataUrl
        ? await uploadDataUrl(draft.idPhotoDataUrl, "ids")
        : "";
      const sigDataUrl = sigCanvasRef.current?.toDataURL("image/png") ?? "";
      const signatureUrl = sigDataUrl ? await uploadDataUrl(sigDataUrl, "signatures") : "";

      const createdByName =
        emailToUsername(user.email ?? "").charAt(0).toUpperCase() +
        emailToUsername(user.email ?? "").slice(1);

      await addDoc(collection(getDb(), "cash_payments"), {
        type: "trial-shift",
        reason: "Trial Shift",
        recipientName: draft.fullName,
        recipientMobile: draft.mobile,
        recipientEmail: draft.email || null,
        idType: draft.idType,
        idPhotoUrl,
        trial: {
          date: draft.date,
          startTime: draft.startTime,
          finishTime: draft.finishTime,
          hoursWorked: draft.hoursWorked,
          position: draft.position,
          ratePerHour: parseFloat(draft.ratePerHour) || 0,
        },
        outcome: draft.outcome,
        paymentMethod,
        amount: draft.totalAmount,
        notes: notes.trim() || null,
        signatureUrl,
        signed: true,
        paidAt: draft.date ? new Date(`${draft.date}T12:00:00`) : new Date(),
        createdAt: serverTimestamp(),
        createdByUid: user.uid,
        createdByName,
      });

      try { window.sessionStorage.removeItem(TRIAL_DRAFT_KEY); } catch { /* ignore */ }
      router.push("/people/cash-payments");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save payment.");
      setSaving(false);
    }
  }

  if (authLoading || !hydrated) return <Splash />;
  if (!allowed || !draft) return null;

  const checkMark = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => {
            if (subStep === 2) setSubStep(1);
            else router.push("/people/cash-payments/new/trial-shift");
          }}
          aria-label="Back"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className={styles.title}>Trial Shift Payment</h1>
        <span />
      </header>

      {/* Stepper — 3 steps */}
      <div className={styles.stepper}>
        <div className={`${styles.step} ${styles.stepDone}`}>
          <span className={styles.stepBubble}>{checkMark}</span>
          <span className={styles.stepLabel}>Details</span>
        </div>
        <span className={styles.stepLine} />
        <div className={`${styles.step} ${subStep === 1 ? styles.stepActive : styles.stepDone}`}>
          <span className={styles.stepBubble}>{subStep === 1 ? "2" : checkMark}</span>
          <span className={styles.stepLabel}>Payment</span>
        </div>
        <span className={styles.stepLine} />
        <div className={`${styles.step} ${subStep === 2 ? styles.stepActive : ""}`}>
          <span className={styles.stepBubble}>3</span>
          <span className={styles.stepLabel}>Signature</span>
        </div>
      </div>

      {subStep === 1 && (
        <>
          {/* 5. Payment Details */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>5. Payment Details</h2>
            <div className={styles.field}>
              <label className={styles.fieldLabel}>
                Payment Method <span className={styles.requiredMark}>*</span>
              </label>
              <select
                className={styles.input}
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as "Cash")}
              >
                <option value="Cash">Cash</option>
              </select>
            </div>

            <div className={styles.amountCard}>
              <p className={styles.amountLabel}>Amount Paid <span className={styles.requiredMark}>*</span></p>
              <p className={styles.amountValue}>{fmtCurrency(draft.totalAmount)}</p>
              <div className={styles.amountIcon} aria-hidden="true">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="5" y="3" width="14" height="18" rx="2" />
                  <line x1="12" y1="8" x2="12" y2="16" />
                  <path d="M14.5 10.5a2 2 0 0 0-2-2h-1a1.5 1.5 0 0 0 0 3h1a1.5 1.5 0 0 1 0 3h-1a2 2 0 0 1-2-2" />
                </svg>
              </div>
              <p className={styles.amountFoot}>Cash payment given on</p>
              <p className={styles.amountDate}>{fmtIsoLong(draft.date)}</p>
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel}>
                Notes <span className={styles.optionalMark}>(Optional)</span>
              </label>
              <textarea
                className={styles.textarea}
                placeholder="e.g. Trial shift for Hall Staff position."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                maxLength={500}
              />
            </div>
          </section>

          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() => setSubStep(2)}
          >
            Next
          </button>
        </>
      )}

      {subStep === 2 && (
        <>
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
                I confirm that I have received <strong>{fmtCurrency(draft.totalAmount)}</strong> cash
                payment for my trial shift at <strong>YURICA Japanese Kitchen</strong> on{" "}
                <strong>{fmtIsoLong(draft.date)}</strong>.
              </p>
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel}>
                Signature <span className={styles.requiredMark}>*</span>
              </label>
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
            </div>
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
