"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import SignaturePad from "@/components/SignaturePad";
import EmploymentAgreementDocument from "@/components/EmploymentAgreementDocument";
import { useLang } from "@/components/LanguageProvider";
import styles from "../staff-handbook/page.module.css";

const AGREEMENT_VERSION = "1.0";
const AGREEMENT_UPDATED = "June 2026";

export default function EmployeeAgreementPage() {
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
            agreementSignedAt: serverTimestamp(),
            agreementVersion: AGREEMENT_VERSION,
            agreementReadAcknowledged: true,
            agreementAgreed: true,
            agreementSignature: signatureDataUrl,
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

      <EmploymentAgreementDocument>
          <div className={styles.signatureBlock}>
            <span className={styles.signatureLabel}>
              {t("onb.pol.signatureIntroAgreement")}
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
              <span>Version</span>
              <span>{AGREEMENT_VERSION}</span>
            </div>
            <div className={styles.metaItem}>
              <span>Last Updated</span>
              <span>{AGREEMENT_UPDATED}</span>
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
      </EmploymentAgreementDocument>

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
