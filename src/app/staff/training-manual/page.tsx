"use client";

/**
 * Training Manual — versioned kitchen/hall training document.
 *
 * MVP first pass: renders a static v2.4 shell with three placeholder
 * updated sections and a Chuck-signature acknowledgement block. Owner
 * flagged the full data model (`training_manual_versions` collection
 * with per-user acks) as a follow-up — this page is what "Review Now"
 * and the sidebar's Team → Training Manual link both point at so
 * neither dead-ends while the backing store is being designed.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import SignaturePad from "@/components/SignaturePad";
import styles from "./page.module.css";

const MANUAL_VERSION = "v2.4";
const MANUAL_UPDATED_ISO = "2026-07-24";

type UpdatedSection = {
  number: number;
  title: string;
  summary: string;
};

const UPDATED_SECTIONS: UpdatedSection[] = [
  {
    number: 3,
    title: "Food Safety",
    summary: "Sushi rice holding temperature has been updated.",
  },
  {
    number: 7,
    title: "Kitchen Cleanliness",
    summary: "New cleaning procedure for fryer added.",
  },
  {
    number: 12,
    title: "Knife Handling",
    summary: "Knife storage policy has been updated.",
  },
];

function fmtLongDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function nameOf(email: string | null | undefined): string {
  if (!email) return "";
  const u = email.split("@")[0] ?? "";
  return u.charAt(0).toUpperCase() + u.slice(1);
}

export default function TrainingManualPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const [saved, setSaved] = useState(false);
  const canSubmit = !!signatureDataUrl && !saved;

  function handleSubmit() {
    if (!canSubmit) return;
    // Persistence lives in a follow-up commit — the flow is wired
    // end-to-end visually so the owner can review UX first, then
    // point us at the Firestore collection shape they want.
    setSaved(true);
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button
          type="button"
          className={styles.backBtn}
          onClick={() => router.back()}
          aria-label="Back"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className={styles.pageTitle}>Training Manual</h1>
        <span aria-hidden="true" style={{ width: 22 }} />
      </header>

      <section className={styles.heroCard}>
        <div className={styles.heroIconWrap} aria-hidden="true">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="12" y1="12" x2="12" y2="18" />
            <line x1="9" y1="15" x2="15" y2="15" />
          </svg>
          <span className={styles.heroVersionBadge}>{MANUAL_VERSION}</span>
        </div>
        <div className={styles.heroBody}>
          <p className={styles.heroEyebrow}>{saved ? "REVIEWED" : "NEW UPDATE"}</p>
          <p className={styles.heroTitle}>Training Manual {MANUAL_VERSION}</p>
          <p className={styles.heroMeta}>Updated {fmtLongDate(MANUAL_UPDATED_ISO)}</p>
          {saved && <p className={styles.heroChangesReviewed}>✓ Changes reviewed</p>}
          <p className={styles.heroSub}>
            Please read the updated sections below and sign to acknowledge.
          </p>
        </div>
      </section>

      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Updated Sections</h2>
        <span className={styles.sectionCount}>({UPDATED_SECTIONS.length})</span>
      </div>
      <ul className={styles.updatedList}>
        {UPDATED_SECTIONS.map((s) => (
          <li key={s.number} className={styles.updatedRow}>
            <span className={styles.updatedNum}>{s.number}</span>
            <div className={styles.updatedBody}>
              <p className={styles.updatedTitle}>
                Section {s.number} · <span className={styles.updatedTitleBold}>{s.title}</span>
              </p>
              <p className={styles.updatedSummary}>{s.summary}</p>
            </div>
            <span className={styles.updatedChev} aria-hidden="true">›</span>
          </li>
        ))}
      </ul>

      <div className={styles.viewFullRow}>
        <span className={styles.viewFullIcon} aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </span>
        <p className={styles.viewFullText}>You can view the full manual if needed.</p>
        <button type="button" className={styles.viewFullBtn}>
          View Full Manual →
        </button>
      </div>

      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Guides</h2>
      </div>
      <ul className={styles.updatedList}>
        <li>
          <Link href="/staff/beer-guide" className={`${styles.updatedRow} ${styles.guideLink}`}>
            <span className={styles.guideIcon} aria-hidden="true">🍺</span>
            <div className={styles.updatedBody}>
              <p className={styles.updatedTitle}>
                <span className={styles.updatedTitleBold}>Beer Guide</span>
              </p>
              <p className={styles.updatedSummary}>Pouring and tap maintenance videos.</p>
            </div>
            <span className={styles.updatedChev} aria-hidden="true">›</span>
          </Link>
        </li>
      </ul>

      <h2 className={styles.sectionTitleAck}>Acknowledgement</h2>
      <section className={styles.ackCard}>
        <div className={styles.ackHead}>
          <span className={styles.ackAvatar} aria-hidden="true">
            {nameOf(user?.email).charAt(0) || "C"}
          </span>
          <div className={styles.ackName}>
            <p className={styles.ackNameMain}>{nameOf(user?.email) || "Chuck"}</p>
            <p className={styles.ackNameRole}>Head Chef</p>
          </div>
        </div>
        <p className={styles.ackDeclaration}>
          By signing below, I confirm that I have reviewed the updated sections of{" "}
          <strong>Training Manual {MANUAL_VERSION}</strong> and understand the changes.
        </p>
        <p className={styles.ackSignatureLabel}>Signature <span className={styles.required}>*</span></p>
        {signatureDataUrl ? (
          <div className={styles.signaturePreview}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={signatureDataUrl} alt="Your signature" className={styles.signatureImg} />
            <button
              type="button"
              className={styles.signatureClear}
              onClick={() => setSignatureDataUrl(null)}
              disabled={saved}
            >
              Clear
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={styles.signHere}
            onClick={() => setShowSignaturePad(true)}
          >
            Sign here
          </button>
        )}
      </section>

      <button
        type="button"
        className={styles.submitBtn}
        disabled={!canSubmit}
        onClick={handleSubmit}
      >
        <span aria-hidden="true">✓</span> {saved ? "Acknowledged" : "Sign & Acknowledge"}
      </button>
      <p className={styles.recordNote}>
        <span aria-hidden="true">🔒</span> Your acknowledgement will be recorded.
      </p>

      {showSignaturePad && (
        <SignaturePad
          onConfirm={(dataUrl) => {
            setSignatureDataUrl(dataUrl);
            setShowSignaturePad(false);
          }}
          onClose={() => setShowSignaturePad(false)}
        />
      )}
    </div>
  );
}
