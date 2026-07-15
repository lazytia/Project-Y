"use client";

import { useLang } from "@/components/LanguageProvider";
import LanguageToggle from "@/components/LanguageToggle";
import styles from "./page.module.css";

/**
 * Staff-facing Settings screen. Currently only exposes the language
 * toggle (EN / 日本語) since Yurica has a large Japanese crew who
 * asked for the staff app in their language. Persistence lives in
 * LanguageProvider (localStorage `y.lang`).
 */
export default function StaffSettingsPage() {
  const { t } = useLang();
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t("settings.title")}</h1>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>{t("settings.language.title")}</h2>
          <p className={styles.cardHelp}>{t("settings.language.help")}</p>
        </div>
        <div className={styles.cardControl}>
          <LanguageToggle />
        </div>
      </section>
    </div>
  );
}
