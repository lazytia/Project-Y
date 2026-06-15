"use client";

import { useEffect, useState } from "react";
import { doc, getDoc, type Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
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

export default function MyDocumentsPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [docs, setDocs] = useState<StaffDocs>({});

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

  if (loading) return <Splash />;

  const visaActive = Boolean(docs.visaUrl);
  const rsaActive = Boolean(docs.rsaUrl);
  const visaExpiry = tsToDate(docs.visaExpiry);

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>My Documents</h1>
      <p className={styles.subtitle}>
        View your important documents.<br />
        Upload new versions if your details have changed.
      </p>

      <a
        href={docs.visaUrl ?? "#"}
        target={docs.visaUrl ? "_blank" : undefined}
        rel="noreferrer"
        className={styles.docCard}
        aria-disabled={!visaActive}
      >
        <span className={styles.docIcon} aria-hidden="true">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="3" width="14" height="18" rx="2" />
            <circle cx="12" cy="11" r="3.2" />
            <path d="M9 16.5h6" />
          </svg>
        </span>
        <span className={styles.docBody}>
          <span className={styles.docName}>Visa</span>
          <span className={styles.docMeta}>
            Expiry: {fmtExpiry(visaExpiry)}
          </span>
        </span>
        {visaActive ? (
          <span className={styles.activeBadge}>Active</span>
        ) : (
          <span className={styles.missingBadge}>Missing</span>
        )}
        <span className={styles.docChevron} aria-hidden="true">›</span>
      </a>

      <a
        href={docs.rsaUrl ?? "#"}
        target={docs.rsaUrl ? "_blank" : undefined}
        rel="noreferrer"
        className={styles.docCard}
        aria-disabled={!rsaActive}
      >
        <span className={styles.docIcon} aria-hidden="true">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="9" r="6" />
            <path d="M8.5 14.5L7 22l5-3 5 3-1.5-7.5" />
          </svg>
        </span>
        <span className={styles.docBody}>
          <span className={styles.docName}>RSA Certificate</span>
        </span>
        {rsaActive ? (
          <span className={styles.activeBadge}>Active</span>
        ) : (
          <span className={styles.missingBadge}>Missing</span>
        )}
        <span className={styles.docChevron} aria-hidden="true">›</span>
      </a>

      <div className={styles.infoBox}>
        <span className={styles.infoIcon} aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </span>
        <p className={styles.infoBody}>
          Upload a new document if your visa or RSA certificate has been
          renewed or changed.
        </p>
      </div>
    </div>
  );
}
