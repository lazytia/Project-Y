"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { doc, getDoc, setDoc, serverTimestamp, type Timestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { getDb } from "@/lib/firebase";
import { getStorage } from "@/lib/firebase-storage";
import { useAuth } from "@/components/AuthProvider";
import { useLang } from "@/components/LanguageProvider";
import { needsRsaCertificate } from "@/lib/staff-display";
import { CLOCK_IN_GUIDE_HREF } from "@/lib/clock-in-guide";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

/** Shared geometry for the training row icons, so one edit moves all four. */
const ICON_PROPS = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/**
 * The reading this page offers, in the order it is handed out: handbook on
 * day one, training manual alongside it, beer guide to sign, clock-in guide
 * to come back to.
 *
 * Labels reuse the `nav.*` keys they had in the sidebar — the rows are the
 * same destinations, so a translation fix only has to land once.
 */
const TRAINING_LINKS: readonly { href: string; labelKey: string; icon: React.ReactNode }[] = [
  {
    href: "/staff/handbook",
    labelKey: "nav.staffHandbook",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
  },
  {
    href: "/staff/training-manual",
    labelKey: "nav.trainingManual",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
      </svg>
    ),
  },
  {
    href: "/staff/beer-guide",
    labelKey: "nav.beerGuide",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M17 11h1a3 3 0 0 1 0 6h-1" />
        <path d="M9 12v6M13 12v6" />
        <path d="M14 7.5a3.5 3.5 0 0 0-7 0" />
        <path d="M5 8h12v10a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z" />
      </svg>
    ),
  },
  {
    href: CLOCK_IN_GUIDE_HREF,
    labelKey: "nav.clockInGuide",
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="12" cy="12" r="9" />
        <polyline points="12 7 12 12 15.5 14" />
      </svg>
    ),
  },
];

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
  const { t } = useLang();
  const [loading, setLoading] = useState(true);
  const [docs, setDocs] = useState<StaffDocs>({});
  /** Whether this employee is asked for an RSA at all — hall staff only. */
  const [wantsRsa, setWantsRsa] = useState(false);
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
        setWantsRsa(needsRsaCertificate(data as Record<string, unknown>));
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
      {/* Named from the nav key that leads here, so the row you press and the
          heading you land on cannot drift apart. */}
      <h1 className={styles.title}>{t("nav.documentsTraining")}</h1>
      <p className={styles.subtitle}>
        {t("docs.subtitleA")}<br />
        {t("docs.subtitleB")}
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
            <p className={styles.docName}>{t("docs.visa")}</p>
            <span className={visaActive ? styles.activeBadge : styles.missingBadge}>
              <span className={styles.badgeDot} aria-hidden="true" />
              {visaActive ? t("docs.active") : t("docs.missing")}
            </span>
            <p className={styles.docMeta}>
              {visaActive ? `${t("docs.expiryPrefix")}${fmtExpiry(visaExpiry)}` : t("docs.noFile")}
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
            <span>{t("docs.viewCurrent")}</span>
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
            <span>{uploading === "visa" ? t("docs.uploading") : t("docs.uploadNewVisa")}</span>
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

      {/* ── RSA — hall staff only; the kitchen is never asked to serve ── */}
      {wantsRsa && (
      <section className={styles.docCard}>
        <div className={styles.docCardTop}>
          <span className={styles.docIcon} aria-hidden="true">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="9" r="6" />
              <path d="M8.5 14.5L7 22l5-3 5 3-1.5-7.5" />
            </svg>
          </span>
          <div className={styles.docCardHeading}>
            <p className={styles.docName}>{t("docs.rsa")}</p>
            <span className={rsaActive ? styles.activeBadge : styles.missingBadge}>
              <span className={styles.badgeDot} aria-hidden="true" />
              {rsaActive ? t("docs.active") : t("docs.missing")}
            </span>
            <p className={styles.docMeta}>
              {rsaActive ? t("docs.noExpiry") : t("docs.noFile")}
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
            <span>{t("docs.viewCurrent")}</span>
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
            <span>{uploading === "rsa" ? t("docs.uploading") : t("docs.uploadNewCert")}</span>
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
      )}

      {error && <p className={styles.error}>{error}</p>}

      {/* ── Training ──
          The reference reading, which used to be a "Handbook & Training"
          group in the sidebar. It sits on this page because the menu is flat
          now, and here rather than anywhere else because these are documents
          too — the difference is only that these are read and signed while
          the cards above are uploaded.

          The clock-in guide is included on purpose. The dashboard promotes it
          for the first fortnight after activation and then drops it, so
          without a row here it would become unreachable for everybody who has
          been on the team longer than two weeks. */}
      <section className={styles.trainingSection}>
        <h2 className={styles.trainingTitle}>{t("docs.trainingTitle")}</h2>
        <p className={styles.trainingSubtitle}>{t("docs.trainingSubtitle")}</p>

        {TRAINING_LINKS.map(({ href, labelKey, icon }) => (
          <Link href={href} key={href} className={styles.trainingRow}>
            <span className={styles.trainingIcon} aria-hidden="true">
              {icon}
            </span>
            <span className={styles.trainingLabel}>{t(labelKey)}</span>
            <span className={styles.trainingChevron} aria-hidden="true">
              ›
            </span>
          </Link>
        ))}
      </section>

      <div className={styles.infoBox}>
        <span className={styles.infoIcon} aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </span>
        <p className={styles.infoBody}>
          {t("docs.reviewA")}<br />
          {t("docs.reviewB")}
        </p>
      </div>
    </div>
  );
}
