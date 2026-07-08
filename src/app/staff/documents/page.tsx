"use client";

import { useEffect, useRef, useState } from "react";
import { doc, getDoc, setDoc, serverTimestamp, type Timestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { getDb } from "@/lib/firebase";
import { getStorage } from "@/lib/firebase-storage";
import { useAuth } from "@/components/AuthProvider";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

type StaffDocs = {
  visaUrl?: string | null;
  rsaUrl?: string | null;
  passportUrl?: string | null;
  visaExpiry?: Timestamp | null;
  rsaExpiry?: Timestamp | null;
};

function tsToDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object" && v !== null && "toDate" in v) {
    return (v as Timestamp).toDate();
  }
  return null;
}

function fmtExpiry(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

type DocKey = "visa" | "rsa";

export default function MyDocumentsPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [docs, setDocs] = useState<StaffDocs>({});
  const [uploading, setUploading] = useState<DocKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const visaInputRef = useRef<HTMLInputElement>(null);
  const rsaInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const snap = await getDoc(doc(getDb(), "staff_onboarding", user.uid));
        const data = snap.data() ?? {};
        setDocs((data.documents ?? {}) as StaffDocs);
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  async function uploadFile(key: DocKey, file: File) {
    if (!user) return;
    setUploading(key);
    setError(null);
    try {
      const ext = file.name.split(".").pop() || "bin";
      const path = `staff_onboarding/${user.uid}/${key}-${Date.now()}.${ext}`;
      const fileRef = ref(getStorage(), path);
      await uploadBytes(fileRef, file, { contentType: file.type });
      const url = await getDownloadURL(fileRef);
      const fieldKey = key === "visa" ? "visaUrl" : "rsaUrl";
      await setDoc(
        doc(getDb(), "staff_onboarding", user.uid),
        {
          documents: { [fieldKey]: url },
          [`${key}PendingReview`]: true,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      setDocs((d) => ({ ...d, [fieldKey]: url }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(null);
    }
  }

  function onPick(key: DocKey, e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) uploadFile(key, f);
    e.target.value = ""; // allow re-selecting the same file
  }

  if (loading) return <Splash />;

  const visaActive = Boolean(docs.visaUrl);
  const rsaActive = Boolean(docs.rsaUrl);
  const visaExpiry = tsToDate(docs.visaExpiry);

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>My Documents</h1>
      <p className={styles.subtitle}>
        View and manage your important documents.<br />
        Upload new versions if your details have changed.
      </p>

      {/* ── Visa ── */}
      <section className={styles.docCard}>
        <div className={styles.docCardTop}>
          <span className={styles.docIcon} aria-hidden="true">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="3" width="14" height="18" rx="2" />
              <circle cx="12" cy="11" r="3.2" />
              <path d="M9 16.5h6" />
            </svg>
          </span>
          <div className={styles.docCardHeading}>
            <p className={styles.docName}>Visa</p>
            <span className={visaActive ? styles.activeBadge : styles.missingBadge}>
              <span className={styles.badgeDot} aria-hidden="true" />
              {visaActive ? "Active" : "Missing"}
            </span>
            <p className={styles.docMeta}>
              {visaActive ? `Expiry: ${fmtExpiry(visaExpiry)}` : "No file uploaded"}
            </p>
          </div>
        </div>

        <div className={styles.divider} />

        <div className={styles.actionRow}>
          <a
            href={docs.visaUrl ?? "#"}
            target={docs.visaUrl ? "_blank" : undefined}
            rel="noreferrer"
            aria-disabled={!visaActive}
            className={`${styles.btnGhost} ${!visaActive ? styles.btnDisabled : ""}`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <span>View Current</span>
          </a>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={() => visaInputRef.current?.click()}
            disabled={uploading !== null}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span>{uploading === "visa" ? "Uploading…" : "Upload New Visa"}</span>
          </button>
          <input
            ref={visaInputRef}
            type="file"
            accept="image/*,application/pdf"
            onChange={(e) => onPick("visa", e)}
            className={styles.hiddenInput}
          />
        </div>
      </section>

      {/* ── RSA ── */}
      <section className={styles.docCard}>
        <div className={styles.docCardTop}>
          <span className={styles.docIcon} aria-hidden="true">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="9" r="6" />
              <path d="M8.5 14.5L7 22l5-3 5 3-1.5-7.5" />
            </svg>
          </span>
          <div className={styles.docCardHeading}>
            <p className={styles.docName}>RSA Certificate</p>
            <span className={rsaActive ? styles.activeBadge : styles.missingBadge}>
              <span className={styles.badgeDot} aria-hidden="true" />
              {rsaActive ? "Active" : "Missing"}
            </span>
            <p className={styles.docMeta}>
              {rsaActive ? "No expiry date" : "No file uploaded"}
            </p>
          </div>
        </div>

        <div className={styles.divider} />

        <div className={styles.actionRow}>
          <a
            href={docs.rsaUrl ?? "#"}
            target={docs.rsaUrl ? "_blank" : undefined}
            rel="noreferrer"
            aria-disabled={!rsaActive}
            className={`${styles.btnGhost} ${!rsaActive ? styles.btnDisabled : ""}`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <span>View Current</span>
          </a>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={() => rsaInputRef.current?.click()}
            disabled={uploading !== null}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span>{uploading === "rsa" ? "Uploading…" : "Upload New Certificate"}</span>
          </button>
          <input
            ref={rsaInputRef}
            type="file"
            accept="image/*,application/pdf"
            onChange={(e) => onPick("rsa", e)}
            className={styles.hiddenInput}
          />
        </div>
      </section>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.infoBox}>
        <span className={styles.infoIcon} aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </span>
        <p className={styles.infoBody}>
          Your new document will be reviewed by an administrator.<br />
          You will be notified once it has been approved.
        </p>
      </div>
    </div>
  );
}
