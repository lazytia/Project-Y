"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { getDb } from "@/lib/firebase";
import { getStorage } from "@/lib/firebase-storage";
import { useAuth } from "@/components/AuthProvider";
import { useLang } from "@/components/LanguageProvider";
import { readDocumentUrls } from "@/lib/onboarding-review";
import { needsRsaCertificate } from "@/lib/staff-display";
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
/** How many photos an employee can attach per document section. */
const MAX_PHOTOS_PER_SECTION = 3;

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

/**
 * One photo in a section.
 *
 * A photo carried over from an earlier visit only exists as a Storage URL —
 * there is no File to re-upload and nothing to compress. A photo just picked
 * on this device is the other way round: a File, plus a blob URL that lives
 * only until the tab closes. Both have to sit in the same list, in the order
 * the employee arranged them, so that the grid, the remove button and the
 * "how many are attached" checks never have to care which kind they hold.
 */
type Attachment =
  | { kind: "stored"; url: string }
  | { kind: "picked"; file: File; previewUrl: string };

/** What to point an <img> at, whichever kind it is. */
function attachmentSrc(a: Attachment): string {
  return a.kind === "stored" ? a.url : a.previewUrl;
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
  const { t } = useLang();

  const [passportDocs, setPassportDocs] = useState<Attachment[]>([]);
  const [visaDocs, setVisaDocs] = useState<Attachment[]>([]);
  const [rsaDocs, setRsaDocs] = useState<Attachment[]>([]);
  /**
   * Whether to ask for an RSA at all.
   *
   * Starts false so that the section cannot flash into view and back out
   * while the position is still being read — the employee would see a third
   * document appear and vanish and reasonably wonder which they were meant
   * to believe.
   */
  const [wantsRsa, setWantsRsa] = useState(false);

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

  // Show what has already been uploaded rather than an empty form.
  //
  // This is what a sent-back section rides on. The owner rejects Documents
  // because one photo is blurred, the employee lands back here, and without
  // this they would be looking at three empty slots and would have to find
  // their passport and visa again to re-shoot documents that were fine. The
  // URLs survive the rejection on purpose — see the `documents` row in
  // onboarding-review.ts.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(getDb(), "staff_onboarding", user.uid));
        if (cancelled || !snap.exists()) return;
        const raw = snap.data() as Record<string, unknown>;
        setWantsRsa(needsRsaCertificate(raw));
        const urls = readDocumentUrls(raw);
        // Functional updates, and only into a section that is still empty:
        // this read is async, and silently swallowing a photo the employee
        // managed to pick while it was in flight would be worse than not
        // pre-filling at all.
        const seed = (list: string[]) => (prev: Attachment[]) =>
          prev.length > 0
            ? prev
            : list
                .slice(0, MAX_PHOTOS_PER_SECTION)
                .map((url) => ({ kind: "stored" as const, url }));
        setPassportDocs(seed(urls.passport));
        setVisaDocs(seed(urls.visa));
        setRsaDocs(seed(urls.rsa));
      } catch {
        // Silent — the employee can still upload from scratch.
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  function handleFileChange(
    e: React.ChangeEvent<HTMLInputElement>,
    docs: Attachment[],
    setDocs: (d: Attachment[]) => void,
  ) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (picked.length === 0) return;
    const remaining = Math.max(0, MAX_PHOTOS_PER_SECTION - docs.length);
    if (remaining === 0) return;
    setDocs([
      ...docs,
      ...picked.slice(0, remaining).map((file) => ({
        kind: "picked" as const,
        file,
        previewUrl: URL.createObjectURL(file),
      })),
    ]);
  }

  function removeDocAt(
    index: number,
    docs: Attachment[],
    setDocs: (d: Attachment[]) => void,
  ) {
    const removed = docs[index];
    // Only a blob URL has to be handed back; a stored one is just a string.
    if (removed?.kind === "picked") URL.revokeObjectURL(removed.previewUrl);
    setDocs(docs.filter((_, i) => i !== index));
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
      // Turn every section into a list of URLs: upload the photos picked on
      // this device, and pass the ones already in Storage straight through.
      //
      // The name carries a timestamp rather than being `<section>/<index>`.
      // Indexes shift the moment a photo is removed, so a fixed name let a
      // newly picked photo land on top of the object a kept photo was still
      // pointing at — the employee replaced one blurred passport page and
      // the other one turned into a copy of it.
      const base = `staff_onboarding/${user.uid}`;
      const stamp = Date.now();
      const resolveAll = (docs: Attachment[], section: string) =>
        Promise.all(
          docs.map((a, i) =>
            a.kind === "stored"
              ? a.url
              : uploadFile(a.file, `${base}/${section}/${stamp}-${i}`),
          ),
        );
      const [passportUrls, visaUrls, rsaUrls] = await Promise.all([
        resolveAll(passportDocs, "passport"),
        resolveAll(visaDocs, "visa"),
        resolveAll(rsaDocs, "rsa"),
      ]);

      const db = getDb();
      const payload: Record<string, unknown> = {
        uid: user.uid,
        documents: {
          // Plural arrays are the source of truth. Singular fields stay
          // populated with the first photo so older readers still work.
          passportUrls,
          visaUrls,
          rsaUrls,
          passportUrl: passportUrls[0] ?? null,
          visaUrl: visaUrls[0] ?? null,
          rsaUrl: rsaUrls[0] ?? null,
        },
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
    // Counts stored photos too — an employee sent back over their visa has
    // a passport on file already, and must not be told to upload it again.
    const missing: string[] = [];
    if (passportDocs.length === 0) missing.push("Passport / Photo ID");
    if (visaDocs.length === 0) missing.push("Visa");

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
    docs: Attachment[];
    setDocs: (d: Attachment[]) => void;
    cameraRef: React.RefObject<HTMLInputElement | null>;
    galleryRef: React.RefObject<HTMLInputElement | null>;
  };

  // The RSA section is only for the people who will be serving alcohol. It is
  // dropped rather than marked optional: an optional slot on a form is still
  // a slot, and the kitchen was reading it as something they had failed to do.
  const sections: DocSection[] = [
    {
      title: t("onb.docs.passportTitle"),
      icon: passportSvg,
      infoText: t("onb.docs.passportHelp"),
      docs: passportDocs,
      setDocs: setPassportDocs,
      cameraRef: passportCameraRef,
      galleryRef: passportGalleryRef,
    },
    {
      title: t("onb.docs.visaTitle"),
      icon: documentSvg,
      infoText: t("onb.docs.visaHelp"),
      docs: visaDocs,
      setDocs: setVisaDocs,
      cameraRef: visaCameraRef,
      galleryRef: visaGalleryRef,
    },
    ...(wantsRsa
      ? [
          {
            title: t("onb.docs.rsaTitle"),
            icon: certificateSvg,
            infoText: t("onb.docs.rsaHelp"),
            docs: rsaDocs,
            setDocs: setRsaDocs,
            cameraRef: rsaCameraRef,
            galleryRef: rsaGalleryRef,
          },
        ]
      : []),
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
        <p className={styles.stepLabel}>{t("onb.stepPrefix")} {CURRENT_STEP} {t("onb.stepOf")} {TOTAL_STEPS}</p>
        <h1 className={styles.title}>{t("onb.docs.title")}</h1>
        <p className={styles.subtitle}>{t("onb.docs.subtitle")}</p>
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
        <p className={styles.formTitle}>{t("onb.docs.formTitle")}</p>
        <p className={styles.formSubtitle}>{t("onb.docs.formSubtitle")}</p>

        <form className={styles.form} onSubmit={(e) => e.preventDefault()}>
          {sections.map((section) => {
            const canAddMore = section.docs.length < MAX_PHOTOS_PER_SECTION;
            return (
              <div key={section.title} className={styles.docSection}>
                <h3 className={styles.docSectionTitle}>{section.title}</h3>

                <div className={styles.docInfoBox}>
                  <span className={styles.docInfoIcon}>{section.icon}</span>
                  <p className={styles.docInfoText}>
                    {section.infoText} You can add up to {MAX_PHOTOS_PER_SECTION} photos.
                  </p>
                </div>

                {section.docs.length > 0 && (
                  <div className={styles.previewGrid}>
                    {section.docs.map((att, idx) => (
                      <div key={attachmentSrc(att)} className={styles.previewWrap}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={attachmentSrc(att)}
                          alt={`Document preview ${idx + 1}`}
                          className={styles.previewImg}
                        />
                        <button
                          type="button"
                          className={styles.removeBtn}
                          onClick={() => removeDocAt(idx, section.docs, section.setDocs)}
                          aria-label={`Remove photo ${idx + 1}`}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {canAddMore ? (
                  <div className={styles.uploadRow}>
                    <button
                      type="button"
                      className={styles.uploadBtn}
                      onClick={() => section.cameraRef.current?.click()}
                    >
                      <span className={styles.uploadBtnIcon}>{cameraSvg}</span>
                      <span className={styles.uploadBtnLabel}>
                        {section.docs.length > 0 ? t("onb.docs.addAnother") : t("onb.docs.takePhoto")}
                      </span>
                      <span className={styles.uploadBtnSub}>{t("onb.docs.camera")}</span>
                    </button>
                    <button
                      type="button"
                      className={styles.uploadBtn}
                      onClick={() => section.galleryRef.current?.click()}
                    >
                      <span className={styles.uploadBtnIcon}>{gallerySvg}</span>
                      <span className={styles.uploadBtnLabel}>{t("onb.docs.chooseFile")}</span>
                      <span className={styles.uploadBtnSub}>{t("onb.docs.gallery")}</span>
                    </button>
                  </div>
                ) : (
                  <p className={styles.docLimitNote}>{t("onb.docs.limit")}</p>
                )}

                <input
                  ref={section.cameraRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className={styles.hiddenInput}
                  onChange={(e) => handleFileChange(e, section.docs, section.setDocs)}
                />
                <input
                  ref={section.galleryRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className={styles.hiddenInput}
                  onChange={(e) => handleFileChange(e, section.docs, section.setDocs)}
                />
              </div>
            );
          })}

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
              {saving ? t("common.loading") : (
                <>
                  <span>{t("common.saveAndContinue")}</span>
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
