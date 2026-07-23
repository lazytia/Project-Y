"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import SignaturePad from "@/components/SignaturePad";
import { useLang } from "@/components/LanguageProvider";
import StaffHandbookDocument, {
  HANDBOOK_UPDATED,
  HANDBOOK_VERSION,
} from "@/components/StaffHandbookDocument";
import styles from "./page.module.css";

export default function StaffHandbookSignPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useLang();
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = !!signatureDataUrl && !submitting;

  async function handleAgree() {
    if (!user || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await setDoc(
        doc(getDb(), "staff_onboarding", user.uid),
        {
          policies: {
            handbookSignedAt: serverTimestamp(),
            handbookVersion: HANDBOOK_VERSION,
            handbookReadAcknowledged: true,
            handbookPoliciesAgreed: true,
            handbookSignature: signatureDataUrl,
          },
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      router.push("/onboarding/policies");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.brand}>YURICA</header>

      <StaffHandbookDocument />

      <section className={styles.section}>
        <h2 className={styles.ackTitle}>{t("onb.pol.hb.ack.title")}</h2>
        <div className={styles.ackUnderline} />
        <p className={styles.ackBody}>{t("onb.pol.hb.ack.body")}</p>

        <div className={styles.signatureBlock}>
          <span className={styles.signatureLabel}>
            {t("onb.pol.signatureIntroHandbook")}
          </span>
          {signatureDataUrl ? (
            <div className={styles.signaturePreview}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={signatureDataUrl}
                alt="Your signature"
                className={styles.signatureImg}
              />
              <button
                type="button"
                className={styles.signatureResign}
                onClick={() => setShowSignaturePad(true)}
              >
                {t("onb.pol.resign")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={styles.signatureEmpty}
              onClick={() => setShowSignaturePad(true)}
            >
              {t("onb.pol.signBtn")}
            </button>
          )}
        </div>

        <div className={styles.metaRow}>
          <div className={styles.metaItem}>
            <span>{t("onb.pol.hb.meta.version")}</span>
            <span>{HANDBOOK_VERSION}</span>
          </div>
          <div className={styles.metaItem}>
            <span>{t("onb.pol.hb.meta.updated")}</span>
            <span>{HANDBOOK_UPDATED}</span>
          </div>
        </div>

        {error && <p className={styles.error}>{error}</p>}

        <button
          type="button"
          className={styles.primaryBtn}
          onClick={handleAgree}
          disabled={!canSubmit}
        >
          {submitting ? t("common.loading") : t("onb.pol.agreeContinue")}
        </button>
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={() => router.push("/onboarding/policies")}
        >
          {t("common.back")}
        </button>
      </section>

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
