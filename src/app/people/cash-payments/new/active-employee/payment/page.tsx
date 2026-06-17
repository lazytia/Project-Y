"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { getDb, getStorage } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { isOwner } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import { emailToUsername } from "@/lib/username";
import Splash from "@/components/Splash";
import styles from "../page.module.css";
import { ACTIVE_DRAFT_KEY, type ActiveEmployeeDraft } from "../draft";

/* ──────────────────────────────────────────────────────────────────────
 * New Cash Payment → Active Employee — Step 2 of 2.
 * Reads the draft from sessionStorage, captures payroll inclusion,
 * employee signature and writes the final cash_payments doc.
 * ──────────────────────────────────────────────────────────────────── */

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

export default function ActiveEmployeePaymentPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwner(user);

  const [draft, setDraft] = useState<ActiveEmployeeDraft | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!allowed) { router.replace(ROUTES.home); return; }
    try {
      const raw = window.sessionStorage.getItem(ACTIVE_DRAFT_KEY);
      if (raw) {
        setDraft(JSON.parse(raw) as ActiveEmployeeDraft);
      } else {
        router.replace("/people/cash-payments/new/active-employee");
        return;
      }
    } catch {
      router.replace("/people/cash-payments/new/active-employee");
      return;
    } finally {
      setHydrated(true);
    }
  }, [authLoading, allowed, router]);

  // Payroll inclusion
  const [payrollIncluded, setPayrollIncluded] = useState<"yes" | "no">("no");

  // Signature canvas
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
      const sigDataUrl = sigCanvasRef.current?.toDataURL("image/png") ?? "";
      const signatureUrl = sigDataUrl ? await uploadDataUrl(sigDataUrl, "signatures") : "";

      const rawName = emailToUsername(user.email ?? "");
      const createdByName = rawName.charAt(0).toUpperCase() + rawName.slice(1);

      await addDoc(collection(getDb(), "cash_payments"), {
        type: "active-employee",
        recipientUid: draft.employeeUid,
        recipientName: draft.employeeName,
        recipientPosition: draft.employeePosition,
        paymentType: draft.paymentType,
        amount: draft.amount,
        reason: draft.reason,
        paymentDate: draft.paymentDate,
        payrollIncluded: payrollIncluded === "yes",
        paymentMethod: "Cash",
        signatureUrl,
        signed: true,
        paidAt: draft.paymentDate
          ? new Date(`${draft.paymentDate}T12:00:00`)
          : new Date(),
        createdAt: serverTimestamp(),
        createdByUid: user.uid,
        createdByName,
      });

      try { window.sessionStorage.removeItem(ACTIVE_DRAFT_KEY); } catch { /* ignore */ }
      router.push("/people/cash-payments");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save payment.");
      setSaving(false);
    }
  }

  if (authLoading || !hydrated) return <Splash />;
  if (!allowed || !draft) return null;

  const rawName = emailToUsername(user?.email ?? "");
  const displayName = rawName.charAt(0).toUpperCase() + rawName.slice(1);

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
          onClick={() => router.push("/people/cash-payments/new/active-employee")}
          aria-label="Back"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className={styles.title}>Active Employee Payment</h1>
        <span />
      </header>

      {/* Stepper */}
      <div className={styles.stepper}>
        <div className={`${styles.step} ${styles.stepDone}`}>
          <span className={styles.stepBubble}>{checkMark}</span>
          <span className={styles.stepLabel}>Details</span>
        </div>
        <span className={styles.stepLine} />
        <div className={`${styles.step} ${styles.stepActive}`}>
          <span className={styles.stepBubble}>2</span>
          <span className={styles.stepLabel}>Payment &amp; Signature</span>
        </div>
      </div>

      {/* 6. Payroll Included? */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>6. Payroll Included?</h2>
        <ul className={styles.radioList}>
          {([
            { v: "yes" as const, label: "Yes, included in payroll" },
            { v: "no" as const, label: "No, not included" },
          ]).map((opt) => (
            <li key={opt.v}>
              <label
                className={`${styles.radioRow} ${payrollIncluded === opt.v ? styles.radioRowOn : ""}`}
              >
                <input
                  type="radio"
                  name="payrollIncluded"
                  className={styles.radioInput}
                  checked={payrollIncluded === opt.v}
                  onChange={() => setPayrollIncluded(opt.v)}
                />
                <span
                  className={`${styles.radioDot} ${payrollIncluded === opt.v ? styles.radioDotOn : ""}`}
                />
                <span className={styles.radioLabel}>{opt.label}</span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      {/* Recorded By */}
      <section className={styles.section}>
        <div className={styles.metaRow}>
          <span className={styles.metaLabel}>Recorded By</span>
          <span className={styles.metaValue}>{displayName}</span>
        </div>
      </section>

      {/* Declaration */}
      <section className={styles.section}>
        <div className={styles.declaration}>
          <span className={styles.declarationIcon} aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <polyline points="9 12 11 14 15 10" />
            </svg>
          </span>
          <p className={styles.declarationTitle}>Declaration</p>
          <p className={styles.declarationBody}>
            I confirm that I have received{" "}
            <strong>{fmtCurrency(draft.amount)}</strong> cash payment from{" "}
            <strong>YURICA Japanese Kitchen</strong>.
          </p>
        </div>
      </section>

      {/* 7. Employee Signature */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          7. Employee Signature <span className={styles.requiredMark}>*</span>
        </h2>
        <div className={styles.field}>
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
        This record will be saved securely and cannot be edited once confirmed.
      </p>
    </div>
  );
}
