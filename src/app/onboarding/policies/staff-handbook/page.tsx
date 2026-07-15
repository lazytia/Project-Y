"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import SignaturePad from "@/components/SignaturePad";
import { useLang } from "@/components/LanguageProvider";
import styles from "./page.module.css";

const HANDBOOK_VERSION = "1.0";
const HANDBOOK_UPDATED = "June 2026";

export default function StaffHandbookPage() {
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

      <article className={styles.doc}>
        {/* Cover */}
        <section className={styles.coverSection}>
          <h1 className={styles.coverTitle}>
            YURICA<br />
            <span className={styles.coverTitleSub}>{t("onb.pol.hb.coverSub")}</span>
          </h1>
          <div className={styles.coverDivider} />
          <p className={styles.coverWelcome}>{t("onb.pol.hb.coverWelcome")}</p>
          <p className={styles.coverParagraph}>{t("onb.pol.hb.coverThanks")}</p>
          <p className={styles.coverParagraph}>{t("onb.pol.hb.coverIntro")}</p>
          <div className={styles.coverQuote}>
            <span className={styles.quoteMark}>&ldquo;</span>
            <p>{t("onb.pol.hb.quote1")}</p>
            <p>{t("onb.pol.hb.quote2")}</p>
            <p>{t("onb.pol.hb.quote3")}</p>
            <span className={styles.quoteMarkClose}>&rdquo;</span>
          </div>
        </section>

        {/* 1. Our Values */}
        <section className={styles.section}>
          <h2 className={styles.sectionH}>{t("onb.pol.hb.s1.h")}</h2>
          <ul className={styles.valueList}>
            <li>
              <p className={styles.valueLabel}>{t("onb.pol.hb.s1.respect")}</p>
              <p className={styles.valueDesc}>{t("onb.pol.hb.s1.respectDesc")}</p>
            </li>
            <li>
              <p className={styles.valueLabel}>{t("onb.pol.hb.s1.teamwork")}</p>
              <p className={styles.valueDesc}>{t("onb.pol.hb.s1.teamworkDesc")}</p>
            </li>
            <li>
              <p className={styles.valueLabel}>{t("onb.pol.hb.s1.professionalism")}</p>
              <p className={styles.valueDesc}>{t("onb.pol.hb.s1.professionalismDesc")}</p>
            </li>
            <li>
              <p className={styles.valueLabel}>{t("onb.pol.hb.s1.detail")}</p>
              <p className={styles.valueDesc}>{t("onb.pol.hb.s1.detailDesc")}</p>
            </li>
          </ul>
        </section>

        {/* 2. Attendance */}
        <section className={styles.section}>
          <h2 className={styles.sectionH}>{t("onb.pol.hb.s2.h")}</h2>
          <ul className={styles.bulletList}>
            <li>{t("onb.pol.hb.s2.b1")}</li>
            <li>{t("onb.pol.hb.s2.b2")}</li>
            <li>{t("onb.pol.hb.s2.b3")}</li>
          </ul>
          <p className={styles.subH}>{t("onb.pol.hb.s2.sub")}</p>
          <p className={styles.paragraph}>{t("onb.pol.hb.s2.p1")}</p>
          <p className={styles.paragraph}>{t("onb.pol.hb.s2.p2")}</p>
        </section>

        {/* 3. Rosters */}
        <section className={styles.section}>
          <h2 className={styles.sectionH}>{t("onb.pol.hb.s3.h")}</h2>
          <p className={styles.paragraph}>{t("onb.pol.hb.s3.p1")}</p>
          <p className={styles.paragraph}>{t("onb.pol.hb.s3.p2")}</p>
          <p className={styles.paragraph}>
            {t("onb.pol.hb.s3.p3Before")}
            <strong>{t("onb.pol.hb.s3.p3Strong")}</strong>
            {t("onb.pol.hb.s3.p3After")}
          </p>
          <p className={styles.paragraph}>{t("onb.pol.hb.s3.p4")}</p>
          <p className={styles.paragraph}>{t("onb.pol.hb.s3.p5")}</p>
          <p className={styles.paragraph}>{t("onb.pol.hb.s3.p6")}</p>
        </section>

        {/* 4. Appearance & Uniform */}
        <section className={styles.section}>
          <h2 className={styles.sectionH}>{t("onb.pol.hb.s4.h")}</h2>
          <p className={styles.paragraph}>{t("onb.pol.hb.s4.p1")}</p>
          <p className={styles.subH}>{t("onb.pol.hb.s4.hall")}</p>
          <ul className={styles.bulletList}>
            <li>{t("onb.pol.hb.s4.hall1")}</li>
            <li>{t("onb.pol.hb.s4.hall2")}</li>
            <li>{t("onb.pol.hb.s4.hall3")}</li>
          </ul>
          <p className={styles.subH}>{t("onb.pol.hb.s4.kitchen")}</p>
          <ul className={styles.bulletList}>
            <li>{t("onb.pol.hb.s4.kitchen1")}</li>
            <li>{t("onb.pol.hb.s4.kitchen2")}</li>
            <li>{t("onb.pol.hb.s4.kitchen3")}</li>
          </ul>
          <p className={styles.subH}>{t("onb.pol.hb.s4.propertyH")}</p>
          <p className={styles.paragraph}>{t("onb.pol.hb.s4.property1")}</p>
          <p className={styles.paragraph}>{t("onb.pol.hb.s4.property2")}</p>
          <p className={styles.paragraph}>{t("onb.pol.hb.s4.property3")}</p>
        </section>

        {/* 5. Guest Service */}
        <section className={styles.section}>
          <h2 className={styles.sectionH}>{t("onb.pol.hb.s5.h")}</h2>
          <p className={styles.subH}>{t("onb.pol.hb.s5.always")}</p>
          <ul className={styles.bulletList}>
            <li>{t("onb.pol.hb.s5.always1")}</li>
            <li>{t("onb.pol.hb.s5.always2")}</li>
            <li>{t("onb.pol.hb.s5.always3")}</li>
            <li>{t("onb.pol.hb.s5.always4")}</li>
          </ul>
          <p className={styles.subH}>{t("onb.pol.hb.s5.never")}</p>
          <ul className={styles.bulletList}>
            <li>{t("onb.pol.hb.s5.never1")}</li>
            <li>{t("onb.pol.hb.s5.never2")}</li>
            <li>{t("onb.pol.hb.s5.never3")}</li>
            <li>{t("onb.pol.hb.s5.never4")}</li>
          </ul>
          <p className={styles.paragraph}>
            <strong>{t("onb.pol.hb.s5.help")}</strong>
          </p>
        </section>

        {/* 6. Food Safety */}
        <section className={styles.section}>
          <h2 className={styles.sectionH}>{t("onb.pol.hb.s6.h")}</h2>
          <p className={styles.paragraph}>{t("onb.pol.hb.s6.intro")}</p>
          <ul className={styles.bulletList}>
            <li>{t("onb.pol.hb.s6.b1")}</li>
            <li>{t("onb.pol.hb.s6.b2")}</li>
            <li>{t("onb.pol.hb.s6.b3")}</li>
            <li>{t("onb.pol.hb.s6.b4")}</li>
            <li>{t("onb.pol.hb.s6.b5")}</li>
          </ul>
        </section>

        {/* 7. Phone */}
        <section className={styles.section}>
          <h2 className={styles.sectionH}>{t("onb.pol.hb.s7.h")}</h2>
          <p className={styles.paragraph}>{t("onb.pol.hb.s7.p1")}</p>
          <p className={styles.paragraph}>{t("onb.pol.hb.s7.p2")}</p>
          <p className={styles.paragraph}>{t("onb.pol.hb.s7.p3")}</p>
        </section>

        {/* 8. Conduct */}
        <section className={styles.section}>
          <h2 className={styles.sectionH}>{t("onb.pol.hb.s8.h")}</h2>
          <p className={styles.paragraph}>{t("onb.pol.hb.s8.expected")}</p>
          <ul className={styles.bulletList}>
            <li>{t("onb.pol.hb.s8.e1")}</li>
            <li>{t("onb.pol.hb.s8.e2")}</li>
            <li>{t("onb.pol.hb.s8.e3")}</li>
            <li>{t("onb.pol.hb.s8.e4")}</li>
            <li>{t("onb.pol.hb.s8.e5")}</li>
          </ul>
          <p className={styles.paragraph}>{t("onb.pol.hb.s8.notTolerated")}</p>
          <ul className={styles.bulletList}>
            <li>{t("onb.pol.hb.s8.n1")}</li>
            <li>{t("onb.pol.hb.s8.n2")}</li>
            <li>{t("onb.pol.hb.s8.n3")}</li>
            <li>{t("onb.pol.hb.s8.n4")}</li>
            <li>{t("onb.pol.hb.s8.n5")}</li>
            <li>{t("onb.pol.hb.s8.n6")}</li>
            <li>{t("onb.pol.hb.s8.n7")}</li>
          </ul>
          <p className={styles.paragraph}>{t("onb.pol.hb.s8.consequence")}</p>
        </section>

        {/* 9. Confidentiality */}
        <section className={styles.section}>
          <h2 className={styles.sectionH}>{t("onb.pol.hb.s9.h")}</h2>
          <p className={styles.paragraph}>{t("onb.pol.hb.s9.p1")}</p>
          <p className={styles.paragraph}>{t("onb.pol.hb.s9.p2")}</p>
        </section>

        {/* 10. Service Philosophy */}
        <section className={styles.section}>
          <h2 className={styles.sectionH}>{t("onb.pol.hb.s10.h")}</h2>
          <p className={styles.paragraph}>{t("onb.pol.hb.s10.p1")}</p>
          <p className={styles.paragraph}>{t("onb.pol.hb.s10.p2")}</p>
          <p className={styles.paragraph}>{t("onb.pol.hb.s10.p3")}</p>
          <p className={styles.paragraph}>{t("onb.pol.hb.s10.p4")}</p>
        </section>

        {/* Final Message */}
        <section className={styles.section}>
          <h2 className={styles.sectionH}>{t("onb.pol.hb.final.h")}</h2>
          <p className={styles.paragraph}>{t("onb.pol.hb.final.p1")}</p>
          <p className={styles.paragraph}>{t("onb.pol.hb.final.ask")}</p>
          <p className={styles.paragraphStrong}>{t("onb.pol.hb.final.a1")}</p>
          <p className={styles.paragraphStrong}>{t("onb.pol.hb.final.a2")}</p>
          <p className={styles.paragraphStrong}>{t("onb.pol.hb.final.a3")}</p>
          <p className={styles.paragraphStrong}>{t("onb.pol.hb.final.a4")}</p>
          <p className={styles.paragraph}>{t("onb.pol.hb.final.thanks")}</p>
        </section>

        {/* Acknowledgement */}
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
