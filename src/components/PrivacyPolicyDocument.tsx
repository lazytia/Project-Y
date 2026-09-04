"use client";

/**
 * The Privacy Policy itself — the wording, and nothing about signing it.
 *
 * Two screens show this document: the onboarding step where a new hire reads
 * and signs it, and the read-only copy the owner opens from HR Records. A
 * second transcription of a legal document is the kind of duplicate that goes
 * unnoticed until the two disagree and nobody can say which one was signed.
 *
 * `children` is rendered at the foot of the article so the onboarding step can
 * put its signature block and buttons inside the same page frame; the
 * read-only copy passes nothing.
 */

import type { ReactNode } from "react";
import { useLang } from "@/components/LanguageProvider";
import styles from "@/app/onboarding/policies/privacy-policy/page.module.css";

export default function PrivacyPolicyDocument({ children }: { children?: ReactNode }) {
  const { t } = useLang();

  return (
    <article className={styles.doc}>
      {/* English-only disclaimer — this legal document is not
          translated to avoid AI-translation ambiguity. */}
      <p className={styles.englishOnlyBanner}>{t("onb.pol.englishOnlyBanner")}</p>

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

      <p className={styles.reassurance}>
        We collect only the information we need, use it only for legitimate
        employment purposes, and treat it with care and confidentiality.
      </p>

      {children}
    </article>
  );
}
