"use client";

/**
 * The Employment Agreement itself — the seven clauses, and nothing about
 * signing them.
 *
 * Shared by the onboarding step where a new hire agrees to it and the
 * read-only copy the owner opens from HR Records, for the same reason the
 * privacy policy next door is shared: one wording, so there is never a
 * question of which one somebody signed.
 *
 * `children` is rendered at the foot of clause 7 — the acknowledgement — so
 * the onboarding step can put its signature block, version stamp and buttons
 * where they have always been. The read-only copy passes nothing.
 */

import type { ReactNode } from "react";
import { useLang } from "@/components/LanguageProvider";
import styles from "@/app/onboarding/policies/staff-handbook/page.module.css";

export default function EmploymentAgreementDocument({ children }: { children?: ReactNode }) {
  const { t } = useLang();

  return (
    <article className={styles.doc}>
      {/* English-only disclaimer — this legal document is not
          translated to avoid AI-translation ambiguity. */}
      <p className={styles.englishOnlyBanner}>{t("onb.pol.englishOnlyBanner")}</p>

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

        {children}
      </section>
    </article>
  );
}
