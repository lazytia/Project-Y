"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import SignaturePad from "@/components/SignaturePad";
import PrivacyPolicyDocument from "@/components/PrivacyPolicyDocument";
import { useLang } from "@/components/LanguageProvider";
import { PRIVACY_POLICY_VERSION } from "@/lib/hr-documents";
import styles from "./page.module.css";

export default function PrivacyPolicyPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useLang();
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue() {
    if (!user || !signatureDataUrl || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await setDoc(
        doc(getDb(), "staff_onboarding", user.uid),
        {
          policies: {
            privacySignedAt: serverTimestamp(),
            privacyVersion: PRIVACY_POLICY_VERSION,
            privacyAcknowledged: true,
            privacySignature: signatureDataUrl,
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
      <header className={styles.brand}>PROJECT Y</header>

      <div className={styles.progressTrack}>
        <div className={styles.progressFill} />
      </div>
      <p className={styles.stepLabel}>Privacy Policy · 1 of 3</p>

      <PrivacyPolicyDocument>
        <div className={styles.signatureBlock}>
          <span className={styles.signatureLabel}>
            {t("onb.pol.signatureIntroPrivacy")}
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

        {error && <p className={styles.error}>{error}</p>}

        <button
          type="button"
          className={styles.continueBtn}
          onClick={handleContinue}
          disabled={!signatureDataUrl || submitting}
        >
          {submitting ? t("common.loading") : t("common.continue")}
        </button>
        <button
          type="button"
          className={styles.backBtn}
          onClick={() => router.push("/onboarding/policies")}
        >
          {t("common.back")}
        </button>
      </PrivacyPolicyDocument>

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
