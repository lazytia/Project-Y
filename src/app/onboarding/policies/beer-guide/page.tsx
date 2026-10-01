"use client";

/**
 * The Beer Guide, signed as part of onboarding.
 *
 * A step of its own rather than a link to /staff/beer-guide because
 * AuthProvider locks anybody mid-onboarding to /onboarding/* — the staff copy
 * is unreachable until they have finished, which is exactly when this needs
 * reading.
 *
 * The signature lands on `staff_onboarding/{uid}.policies` like the other
 * three policy pages, so the checklist next door reads every card off one
 * snapshot. The document-signatures route picks it up from there, so hall
 * staff who sign here are not chased for it again by the staff dashboard.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import SignaturePad from "@/components/SignaturePad";
import BeerGuideDocument from "@/components/BeerGuideDocument";
import { useLang } from "@/components/LanguageProvider";
import { BEER_GUIDE_UPDATED, BEER_GUIDE_VERSION } from "@/lib/hr-documents";
import styles from "../staff-handbook/page.module.css";

export default function BeerGuideSignPage() {
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
            beerGuideSignedAt: serverTimestamp(),
            beerGuideVersion: BEER_GUIDE_VERSION,
            beerGuideReadAcknowledged: true,
            beerGuideSignature: signatureDataUrl,
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

      <BeerGuideDocument />

      <section className={styles.section}>
        <h2 className={styles.ackTitle}>{t("onb.pol.hb.ack.title")}</h2>
        <div className={styles.ackUnderline} />
        <p className={styles.ackBody}>{t("doc.ack.body.beerGuide")}</p>

        <div className={styles.signatureBlock}>
          <span className={styles.signatureLabel}>
            {t("onb.pol.signatureIntroBeerGuide")}
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
            <span>{BEER_GUIDE_VERSION}</span>
          </div>
          <div className={styles.metaItem}>
            <span>{t("onb.pol.hb.meta.updated")}</span>
            <span>{BEER_GUIDE_UPDATED}</span>
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
