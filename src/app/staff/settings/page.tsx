"use client";

import { useLang } from "@/components/LanguageProvider";
import LanguageToggle from "@/components/LanguageToggle";
import styles from "./page.module.css";

/**
 * Staff-facing Settings screen. Currently only exposes the language
 * toggle (EN / 日本語) since Yurica has a large Japanese crew who
 * asked for the staff app in their language. Persistence lives in
 * LanguageProvider (localStorage `y.lang`).
 *
 * Which means the page can be empty: the language choice is withdrawn once
 * the owner activates the employee, and this is the only card on it. It says
 * so rather than rendering a heading over nothing — a screen that looks
 * broken gets reported as broken.
 */
export default function StaffSettingsPage() {
  const { t, canChooseLanguage } = useLang();
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t("settings.title")}</h1>

      {canChooseLanguage ? (
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>{t("settings.language.title")}</h2>
            <p className={styles.cardHelp}>{t("settings.language.help")}</p>
          </div>
          <div className={styles.cardControl}>
            <LanguageToggle />
          </div>
        </section>
      ) : (
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <p className={styles.cardHelp}>{t("settings.empty")}</p>
          </div>
        </section>
      )}
    </div>
  );
}
