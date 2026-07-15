"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import SignaturePad from "@/components/SignaturePad";
import { useLang } from "@/components/LanguageProvider";
import styles from "./page.module.css";

const POLICY_VERSION = "1.0";

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
            privacyVersion: POLICY_VERSION,
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

      <article className={styles.doc}>
        <h1 className={styles.title}>Privacy Policy</h1>

        <p className={styles.paragraph}>
          At YURICA, we respect your privacy and are committed to protecting
          your personal information.
        </p>

        <p className={styles.paragraph}>
          As part of onboarding and employment, we may collect information
          necessary to manage your employment and comply with legal
          obligations.
        </p>

        <p className={styles.paragraphStrong}>This may include:</p>
        <ul className={styles.bulletList}>
          <li>Contact details</li>
          <li>Identification documents</li>
          <li>Visa information</li>
          <li>Tax &amp; payroll details</li>
          <li>Emergency contacts</li>
          <li>Employment records</li>
        </ul>

        <p className={styles.paragraph}>
          Your information is used only for legitimate employment purposes,
          including:
        </p>
        <ul className={styles.bulletList}>
          <li>Verifying work rights</li>
          <li>Managing payroll</li>
          <li>Maintaining employment records</li>
          <li>Meeting legal obligations</li>
          <li>Workplace communication</li>
        </ul>

        <p className={styles.paragraph}>
          Access is limited to authorised personnel and trusted service
          providers who require it to perform their duties.
        </p>

        <p className={styles.paragraph}>
          We do not sell or share your information for marketing purposes.
        </p>

        <p className={styles.paragraph}>
          We take reasonable steps to store and protect your information
          securely.
        </p>

        {/* Declaration */}
        <h2 className={styles.declarationTitle}>Employee Declaration</h2>
        <p className={styles.paragraph}>
          I confirm that I have read and understood this Privacy Policy and
          consent to the collection and use of my personal information for
          employment-related purposes.
        </p>

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

        <p className={styles.reassurance}>
          We collect only the information we need, use it only for legitimate
          employment purposes, and treat it with care and confidentiality.
        </p>

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
      </article>

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
