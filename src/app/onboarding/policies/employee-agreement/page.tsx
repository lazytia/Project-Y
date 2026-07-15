"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import SignaturePad from "@/components/SignaturePad";
import styles from "../staff-handbook/page.module.css";

const AGREEMENT_VERSION = "1.0";
const AGREEMENT_UPDATED = "June 2026";

export default function EmployeeAgreementPage() {
  const router = useRouter();
  const { user } = useAuth();
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

      <article className={styles.doc}>
        {/* Cover */}
        <section className={styles.coverSection}>
          <h1 className={styles.coverTitle}>
            YURICA<br />
            <span className={styles.coverTitleSub}>JAPANESE KITCHEN</span>
          </h1>
          <div className={styles.coverDivider} />
          <h2 className={styles.coverHeadline}>
            EMPLOYMENT<br />AGREEMENT
          </h2>
        </section>

        {/* 1. Employment */}
        <section className={styles.section}>
          <h2 className={styles.sectionH}>1. EMPLOYMENT</h2>
          <p className={styles.paragraph}>
            The Employee agrees to perform their duties professionally and in
            the best interests of YURICA Japanese Kitchen.
          </p>
          <p className={styles.paragraph}>
            The Employee agrees to follow all lawful and reasonable directions
            of management and comply with company policies and procedures.
          </p>
        </section>

        {/* 2. Rosters & Availability */}
        <section className={styles.section}>
          <h2 className={styles.sectionH}>2. ROSTERS &amp; AVAILABILITY</h2>
          <p className={styles.paragraph}>
            Work schedules and roster communications will be provided through
            the Project Y Employee Portal.
          </p>
          <p className={styles.paragraph}>
            Availability changes and holiday requests must be submitted through
            the Project Y Employee Portal at least{" "}
            <strong>3 weeks in advance</strong>.
          </p>
          <p className={styles.paragraph}>
            Requests are not approved unless confirmed by management.
          </p>
        </section>

        {/* 3. Pay */}
        <section className={styles.section}>
          <h2 className={styles.sectionH}>3. PAY</h2>
          <p className={styles.paragraph}>
            The Employee will be paid in accordance with applicable workplace
            laws.
          </p>
          <p className={styles.paragraph}>
            The Employee is paid an above-award rate of pay.
          </p>
          <p className={styles.paragraph}>
            This rate is intended to compensate for and absorb applicable award
            loadings, penalty rates and other monetary entitlements under the
            Hospitality Industry (General) Award 2020, to the extent permitted
            by law.
          </p>
        </section>

        {/* 4. Confidentiality */}
        <section className={styles.section}>
          <h2 className={styles.sectionH}>4. CONFIDENTIALITY</h2>
          <p className={styles.paragraph}>
            The Employee agrees not to disclose confidential information
            relating to YURICA&apos;s operations, systems, customers,
            suppliers, pricing, recipes, or business affairs.
          </p>
          <p className={styles.paragraph}>
            This obligation continues after employment ends.
          </p>
          <h3 className={styles.subSectionH}>SOCIAL MEDIA</h3>
          <p className={styles.paragraph}>
            Photos, videos, screenshots, or recordings taken during work must
            not be posted online or shared publicly without management approval.
          </p>
          <p className={styles.paragraph}>
            This policy helps protect the privacy of our customers and
            employees, as well as YURICA&apos;s confidential business
            information.
          </p>
        </section>

        {/* 5. Company Policies */}
        <section className={styles.section}>
          <h2 className={styles.sectionH}>5. COMPANY POLICIES</h2>
          <p className={styles.paragraph}>
            The Employee acknowledges receipt of the YURICA Staff Handbook and
            agrees to comply with company policies and procedures as updated
            from time to time.
          </p>
        </section>

        {/* 6. Termination */}
        <section className={styles.section}>
          <h2 className={styles.sectionH}>6. TERMINATION</h2>
          <p className={styles.paragraph}>
            Employment may be terminated in accordance with applicable
            workplace laws.
          </p>
          <p className={styles.paragraph}>
            Upon termination, all company property provided by YURICA must be
            returned.
          </p>
        </section>

        {/* 7. Acknowledgement */}
        <section className={styles.section}>
          <h2 className={styles.sectionH}>7. ACKNOWLEDGEMENT</h2>
          <p className={styles.paragraph}>
            I have read and understood this Employment Agreement and agree to
            its terms.
          </p>

          <div className={styles.signatureBlock}>
            <span className={styles.signatureLabel}>
              Signature — by signing you confirm you have read, understood,
              and agree to be bound by this Employment Agreement.
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
                  Re-sign
                </button>
              </div>
            ) : (
              <button
                type="button"
                className={styles.signatureEmpty}
                onClick={() => setShowSignaturePad(true)}
              >
                Sign here
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
            {submitting ? "…" : "AGREE & CONTINUE"}
          </button>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => router.push("/onboarding/policies")}
          >
            BACK
          </button>
        </section>
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
