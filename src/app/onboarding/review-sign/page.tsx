"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  type Timestamp,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { ROUTES } from "@/lib/routes";
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

const CURRENT_STEP = 6;
const TOTAL_STEPS = 7;
const PERCENT = Math.round(((CURRENT_STEP - 1) / TOTAL_STEPS) * 100);

type DocKey = "handbook" | "privacy" | "agreement";

type DocCardConfig = {
  key: DocKey;
  title: string;
  description: string;
  href: string;
  icon: React.ReactNode;
  signedAtField: string;
};

const DOC_CARDS: DocCardConfig[] = [
  {
    key: "handbook",
    title: "Staff Handbook",
    description: "Review the company handbook.",
    href: "/onboarding/review-sign/staff-handbook",
    signedAtField: "handbookSignedAt",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="8" y1="13" x2="16" y2="13" />
        <line x1="8" y1="17" x2="14" y2="17" />
      </svg>
    ),
  },
  {
    key: "privacy",
    title: "Privacy Policy",
    description: "Review how we collect and protect your data.",
    href: "/onboarding/review-sign/privacy-policy",
    signedAtField: "privacySignedAt",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="11" width="16" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
    ),
  },
  {
    key: "agreement",
    title: "Employee Agreement",
    description: "Review and sign your employment agreement.",
    href: "/onboarding/review-sign/employee-agreement",
    signedAtField: "agreementSignedAt",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 19l7-7 3 3-7 7-3-3z" />
        <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
        <path d="M2 2l7.586 7.586" />
        <circle cx="11" cy="11" r="2" />
      </svg>
    ),
  },
];

function fmtDate(t: Timestamp | Date | null | undefined): string {
  if (!t) return "";
  const d = "toDate" in t ? t.toDate() : t;
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function ReviewSignPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [signedAt, setSignedAt] = useState<Record<DocKey, Timestamp | null>>({
    handbook: null,
    privacy: null,
    agreement: null,
  });
  const [loading, setLoading] = useState(true);
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const snap = await getDoc(doc(getDb(), "staff_onboarding", user.uid));
        const data = snap.data() ?? {};
        const rs = (data.reviewSign ?? {}) as Record<string, Timestamp | null>;
        setSignedAt({
          handbook: rs.handbookSignedAt ?? null,
          privacy: rs.privacySignedAt ?? null,
          agreement: rs.agreementSignedAt ?? null,
        });
      } catch {
        /* ignore — render as all-pending */
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  const signedCount = Object.values(signedAt).filter(Boolean).length;
  const allSigned = signedCount === DOC_CARDS.length;
  const progressPct = Math.round((signedCount / DOC_CARDS.length) * 100);

  async function handleFinish() {
    if (!user || finishing) return;
    setFinishing(true);
    try {
      await setDoc(
        doc(getDb(), "staff_onboarding", user.uid),
        {
          completedStep: TOTAL_STEPS,
          step: TOTAL_STEPS,
          status: "complete",
          completedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    } catch {
      /* best-effort */
    }
    router.replace(ROUTES.reservations);
  }

  const checkSvg = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );

  return (
    <div className={styles.page}>
      {/* Header — preserved from prior step layout */}
      <div className={styles.header}>
        <button
          type="button"
          className={styles.backBtn}
          onClick={() => router.push("/onboarding/policies")}
          aria-label="Back to policies"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <p className={styles.stepLabel}>Step {CURRENT_STEP} of {TOTAL_STEPS}</p>
        <h1 className={styles.title}>Review &amp; Sign</h1>
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
          <div className={styles.progressBarFill} style={{ width: `${PERCENT}%` }} />
        </div>
        <span className={styles.progressText}>{PERCENT}% Complete</span>
      </div>

      {/* Section heading */}
      <div className={styles.sectionHeading}>
        <h2 className={styles.sectionTitle}>Review &amp; Sign</h2>
        <p className={styles.sectionSubtitle}>
          Please read and sign the documents below.
        </p>
      </div>

      {/* Document cards */}
      <div className={styles.docList}>
        {DOC_CARDS.map((card) => {
          const signed = signedAt[card.key];
          return (
            <button
              key={card.key}
              type="button"
              className={styles.docCard}
              onClick={() => router.push(card.href)}
              disabled={loading}
            >
              <div className={styles.docIcon}>{card.icon}</div>
              <div className={styles.docBody}>
                <p className={styles.docTitle}>{card.title}</p>
                <p className={styles.docDesc}>{card.description}</p>
                {signed ? (
                  <div className={styles.statusRow}>
                    <span className={styles.signedBadge}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="9 12 11 14 15 10" />
                      </svg>
                      Signed
                    </span>
                    <span className={styles.statusDot}>·</span>
                    <span className={styles.signedDate}>{fmtDate(signed)}</span>
                  </div>
                ) : (
                  <div className={styles.statusRow}>
                    <span className={styles.pendingBadge}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                      Pending
                    </span>
                  </div>
                )}
              </div>
              <span className={styles.docChevron} aria-hidden="true">›</span>
            </button>
          );
        })}
      </div>

      {/* Progress card */}
      <div className={styles.progressCard}>
        <div className={styles.progressCardIcon}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19l7-7 3 3-7 7-3-3z" />
            <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
          </svg>
        </div>
        <div className={styles.progressCardBody}>
          <p className={styles.progressCardTitle}>Review &amp; Sign Progress</p>
          <div className={styles.progressCardRow}>
            <div className={styles.progressCardTrack}>
              <div
                className={styles.progressCardFill}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className={styles.progressCardCount}>
              {signedCount} / {DOC_CARDS.length} Completed
            </span>
          </div>
        </div>
      </div>

      {/* Save & Exit + Complete buttons */}
      <div className={styles.buttonRow}>
        <button
          type="button"
          className={styles.btnSecondary}
          onClick={() => router.push("/onboarding")}
        >
          Save &amp; Exit
        </button>
        <button
          type="button"
          className={styles.btnPrimary}
          onClick={handleFinish}
          disabled={!allSigned || finishing}
        >
          <span>{finishing ? "…" : "Finish Onboarding"}</span>
          <span className={styles.btnArrow}>›</span>
        </button>
      </div>
    </div>
  );
}
