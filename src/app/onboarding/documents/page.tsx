"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { getDb, getStorage } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
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

const CURRENT_STEP = 4;
const TOTAL_STEPS = 7;
const PERCENT = Math.round((4 / 7) * 100);

/** Max edge length and JPEG quality for client-side resize before upload. */
const COMPRESS_MAX_EDGE = 1600;
const COMPRESS_QUALITY = 0.82;

/**
 * Downscale + re-encode an image File to a JPEG Blob that's well under 1 MB.
 * Phone photos are typically 3–10 MB, so this cuts upload size 10–20×.
 * PDFs / non-images pass through unchanged.
 */
async function compressImage(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;

  const { width, height } = bitmap;
  const scale = Math.min(1, COMPRESS_MAX_EDGE / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", COMPRESS_QUALITY),
  );
  return blob ?? file;
}

async function uploadFile(file: File, path: string): Promise<string> {
  const storage = getStorage();
  const fileRef = ref(storage, path);
  const data = await compressImage(file);
  await uploadBytes(fileRef, data, {
    contentType: data.type || "image/jpeg",
    cacheControl: "public, max-age=31536000, immutable",
  });
  return getDownloadURL(fileRef);
}

export default function DocumentsPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [passportFile, setPassportFile] = useState<File | null>(null);
  const [passportPreview, setPassportPreview] = useState<string | null>(null);
  const [visaFile, setVisaFile] = useState<File | null>(null);
  const [visaPreview, setVisaPreview] = useState<string | null>(null);
  const [rsaFile, setRsaFile] = useState<File | null>(null);
  const [rsaPreview, setRsaPreview] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorTitle, setErrorTitle] = useState("Required Fields Missing");
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [showToast, setShowToast] = useState(false);

  const passportCameraRef = useRef<HTMLInputElement>(null);
  const passportGalleryRef = useRef<HTMLInputElement>(null);
  const visaCameraRef = useRef<HTMLInputElement>(null);
  const visaGalleryRef = useRef<HTMLInputElement>(null);
  const rsaCameraRef = useRef<HTMLInputElement>(null);
  const rsaGalleryRef = useRef<HTMLInputElement>(null);

  function handleFileChange(
    e: React.ChangeEvent<HTMLInputElement>,
    setFile: (f: File | null) => void,
    setPreview: (p: string | null) => void
  ) {
    const file = e.target.files?.[0] ?? null;
    setFile(file);
    if (file) {
      const url = URL.createObjectURL(file);
      setPreview(url);
    } else {
      setPreview(null);
    }
    e.target.value = "";
  }

  function removeFile(
    setFile: (f: File | null) => void,
    setPreview: (p: string | null) => void
  ) {
    setFile(null);
    setPreview(null);
  }

  async function saveToFirestore(markComplete = false) {
    if (!user) {
      setError("Could not find your login info. Please sign in again.");
      setErrorTitle("Authentication Error");
      setShowErrorModal(true);
      return false;
    }
    setSaving(true);
    setError(null);
    try {
      // Compress + upload all three documents in parallel.
      const base = `staff_onboarding/${user.uid}`;
      const [passportUrl, visaUrl, rsaUrl] = await Promise.all([
        passportFile ? uploadFile(passportFile, `${base}/passport`) : Promise.resolve(null),
        visaFile     ? uploadFile(visaFile,     `${base}/visa`)     : Promise.resolve(null),
        rsaFile      ? uploadFile(rsaFile,      `${base}/rsa`)      : Promise.resolve(null),
      ]);

      const db = getDb();
      const payload: Record<string, unknown> = {
        uid: user.uid,
        documents: { passportUrl, visaUrl, rsaUrl },
        step: CURRENT_STEP,
        status: markComplete ? "step_complete" : "in_progress",
        updatedAt: serverTimestamp(),
      };
      if (markComplete) payload.completedStep = CURRENT_STEP;
      await setDoc(doc(db, "staff_onboarding", user.uid), payload, { merge: true });
      return true;
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to save. Please try again.";
      setError(msg);
      setErrorTitle("Save Failed");
      setShowErrorModal(true);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveAndContinue() {
    const missing: string[] = [];
    if (!passportFile) missing.push("Passport / Photo ID");
    if (!visaFile) missing.push("Visa");
    if (!rsaFile) missing.push("RSA Certificate");

    if (missing.length > 0) {
      setErrorTitle("Required Documents Missing");
      setError(`Please upload the required documents:\n${missing.join("\n")}`);
      setShowErrorModal(true);
      return;
    }

    const ok = await saveToFirestore(true);
    if (ok) {
      setShowToast(true);
      setTimeout(() => router.push("/onboarding/policies"), 1800);
    }
  }

  async function handleSaveAndExit() {
    const ok = await saveToFirestore(false);
    if (ok) router.push("/onboarding");
  }

  const checkSvg = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );

  const passportSvg = (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="2" width="18" height="20" rx="2" ry="2" />
      <circle cx="12" cy="10" r="3" />
      <path d="M7 20c0-2.76 2.24-5 5-5s5 2.24 5 5" />
    </svg>
  );

  const documentSvg = (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );

  const certificateSvg = (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="6" />
      <path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" />
    </svg>
  );

  const cameraSvg = (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );

  const gallerySvg = (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );

  type DocSection = {
    title: string;
    icon: React.ReactNode;
    infoText: string;
    file: File | null;
    preview: string | null;
    setFile: (f: File | null) => void;
    setPreview: (p: string | null) => void;
    cameraRef: React.RefObject<HTMLInputElement | null>;
    galleryRef: React.RefObject<HTMLInputElement | null>;
  };

  const sections: DocSection[] = [
    {
      title: "1. Passport / Photo ID *",
      icon: passportSvg,
      infoText: "We need a clear photo of your passport or either government-issued photo ID.",
      file: passportFile,
      preview: passportPreview,
      setFile: setPassportFile,
      setPreview: setPassportPreview,
      cameraRef: passportCameraRef,
      galleryRef: passportGalleryRef,
    },
    {
      title: "2. Visa *",
      icon: documentSvg,
      infoText: "We need a copy of your current visa.",
      file: visaFile,
      preview: visaPreview,
      setFile: setVisaFile,
      setPreview: setVisaPreview,
      cameraRef: visaCameraRef,
      galleryRef: visaGalleryRef,
    },
    {
      title: "3. RSA Certificate *",
      icon: certificateSvg,
      infoText: "Upload your valid RSA certificate (required for all hall staff).",
      file: rsaFile,
      preview: rsaPreview,
      setFile: setRsaFile,
      setPreview: setRsaPreview,
      cameraRef: rsaCameraRef,
      galleryRef: rsaGalleryRef,
    },
  ];

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <button
          type="button"
          className={styles.backBtn}
          onClick={() => router.push("/onboarding/bank-super-details")}
          aria-label="Back to Bank & Super Details"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <p className={styles.stepLabel}>Step {CURRENT_STEP} of {TOTAL_STEPS}</p>
        <h1 className={styles.title}>Documents</h1>
        <p className={styles.subtitle}>Please upload clear photos of the required documents.</p>
      </div>

      {/* Step Indicators */}
      <div className={styles.stepsContainer}>
        {STEPS.map((step, idx) => (
          <div key={step.num} className={styles.stepItem}>
            {idx > 0 && <div className={styles.connector} />}
            <div className={styles.stepCircleWrap}>
              <div
                className={
                  step.num < CURRENT_STEP
                    ? `${styles.stepCircle} ${styles.stepCircleCompleted}`
                    : step.num === CURRENT_STEP
                    ? `${styles.stepCircle} ${styles.stepCircleActive}`
                    : styles.stepCircle
                }
              >
                {step.num < CURRENT_STEP ? checkSvg : step.num}
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
        <p className={styles.formTitle}>Upload your documents.</p>
        <p className={styles.formSubtitle}>All fields marked with * are required.</p>

        <form className={styles.form} onSubmit={(e) => e.preventDefault()}>
          {sections.map((section) => (
            <div key={section.title} className={styles.docSection}>
              <h3 className={styles.docSectionTitle}>{section.title}</h3>

              <div className={styles.docInfoBox}>
                <span className={styles.docInfoIcon}>{section.icon}</span>
                <p className={styles.docInfoText}>{section.infoText}</p>
              </div>

              {section.preview ? (
                <div className={styles.previewWrap}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={section.preview}
                    alt="Document preview"
                    className={styles.previewImg}
                  />
                  <button
                    type="button"
                    className={styles.removeBtn}
                    onClick={() => removeFile(section.setFile, section.setPreview)}
                    aria-label="Remove file"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <div className={styles.uploadRow}>
                  <button
                    type="button"
                    className={styles.uploadBtn}
                    onClick={() => section.cameraRef.current?.click()}
                  >
                    <span className={styles.uploadBtnIcon}>{cameraSvg}</span>
                    <span className={styles.uploadBtnLabel}>Take a photo</span>
                    <span className={styles.uploadBtnSub}>Camera</span>
                  </button>
                  <button
                    type="button"
                    className={styles.uploadBtn}
                    onClick={() => section.galleryRef.current?.click()}
                  >
                    <span className={styles.uploadBtnIcon}>{gallerySvg}</span>
                    <span className={styles.uploadBtnLabel}>Choose file</span>
                    <span className={styles.uploadBtnSub}>Gallery</span>
                  </button>
                </div>
              )}

              <input
                ref={section.cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                className={styles.hiddenInput}
                onChange={(e) => handleFileChange(e, section.setFile, section.setPreview)}
              />
              <input
                ref={section.galleryRef}
                type="file"
                accept="image/*"
                className={styles.hiddenInput}
                onChange={(e) => handleFileChange(e, section.setFile, section.setPreview)}
              />
            </div>
          ))}

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
              {saving ? "Saving..." : (
                <>
                  <span>Save &amp; Continue</span>
                  <span className={styles.btnArrow}>›</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Toast */}
      {showToast && (
        <Toast
          title="Documents completed"
          message="Great! Your documents have been uploaded."
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
