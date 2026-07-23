"use client";

import { useLang } from "@/components/LanguageProvider";
import handbookStyles from "@/app/onboarding/policies/staff-handbook/page.module.css";

/** Shared YURICA Staff Handbook body (cover through final message). */
export default function StaffHandbookDocument() {
  const { t } = useLang();
  const styles = handbookStyles;

  return (
    <article className={styles.doc}>
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

      <section className={styles.section}>
        <h2 className={styles.sectionH}>{t("onb.pol.hb.s7.h")}</h2>
        <p className={styles.paragraph}>{t("onb.pol.hb.s7.p1")}</p>
        <p className={styles.paragraph}>{t("onb.pol.hb.s7.p2")}</p>
        <p className={styles.paragraph}>{t("onb.pol.hb.s7.p3")}</p>
      </section>

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

      <section className={styles.section}>
        <h2 className={styles.sectionH}>{t("onb.pol.hb.s9.h")}</h2>
        <p className={styles.paragraph}>{t("onb.pol.hb.s9.p1")}</p>
        <p className={styles.paragraph}>{t("onb.pol.hb.s9.p2")}</p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionH}>{t("onb.pol.hb.s10.h")}</h2>
        <p className={styles.paragraph}>{t("onb.pol.hb.s10.p1")}</p>
        <p className={styles.paragraph}>{t("onb.pol.hb.s10.p2")}</p>
        <p className={styles.paragraph}>{t("onb.pol.hb.s10.p3")}</p>
        <p className={styles.paragraph}>{t("onb.pol.hb.s10.p4")}</p>
      </section>

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
    </article>
  );
}

export const HANDBOOK_VERSION = "1.0";
export const HANDBOOK_UPDATED = "June 2026";
