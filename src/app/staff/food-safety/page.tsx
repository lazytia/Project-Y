"use client";

import Link from "next/link";
import { useLang } from "@/components/LanguageProvider";
import styles from "./page.module.css";

/**
 * Food Safety & Hygiene.
 *
 * The content is section 6 of the staff handbook, rendered from the same
 * `onb.pol.hb.s6.*` keys the handbook itself uses rather than copied. It is
 * lifted out onto its own screen because it is the part of the handbook the
 * kitchen is asked about, and reaching it meant scrolling a document written
 * mostly about something else.
 *
 * Reading from the shared keys is the point: when the handbook wording is
 * corrected, this page is corrected with it, and the two can never end up
 * telling staff different things about the same rule.
 */
const RULE_KEYS = [
  "onb.pol.hb.s6.b1",
  "onb.pol.hb.s6.b2",
  "onb.pol.hb.s6.b3",
  "onb.pol.hb.s6.b4",
  "onb.pol.hb.s6.b5",
] as const;

export default function FoodSafetyPage() {
  const { t } = useLang();

  return (
    <div className={styles.page}>
      <div className={styles.titleWrap}>
        <span className={styles.titleIcon} aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 2v9a2 2 0 0 0 2 2v9" />
            <path d="M11 2v7M4 2v7a3 3 0 0 0 3 3" />
            <path d="M18 2c-1.5 2-2 4-2 7h4c0-3-.5-5-2-7z" />
            <path d="M18 9v13" />
          </svg>
        </span>
        <h1 className={styles.pageTitle}>{t("docs.hub.foodSafety")}</h1>
      </div>

      <div className={styles.rule} />

      <p className={styles.intro}>{t("onb.pol.hb.s6.intro")}</p>

      <ul className={styles.list}>
        {RULE_KEYS.map((key) => (
          <li key={key} className={styles.item}>
            {t(key)}
          </li>
        ))}
      </ul>

      <div className={styles.infoBox}>
        <span className={styles.infoIcon} aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </span>
        <p className={styles.infoBody}>
          {t("docs.foodSafety.handbookNote")}{" "}
          <Link href="/staff/handbook" className={styles.infoLink}>
            {t("nav.staffHandbook")}
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
