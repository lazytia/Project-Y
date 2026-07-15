"use client";

import { useLang } from "./LanguageProvider";
import { LANGS, type Lang } from "@/lib/translations";
import styles from "./LanguageToggle.module.css";

/**
 * Compact EN / 日本語 pill toggle. Used on the notifications first-login
 * screen and on the staff Settings page. Purely visual — persistence
 * happens inside LanguageProvider when setLang is called.
 */

const LABELS: Record<Lang, string> = {
  en: "EN",
  ja: "日本語",
};

export default function LanguageToggle() {
  const { lang, setLang } = useLang();
  return (
    <div className={styles.wrap} role="group" aria-label="Language selector">
      {LANGS.map((code) => (
        <button
          key={code}
          type="button"
          className={`${styles.pill} ${lang === code ? styles.pillActive : ""}`}
          onClick={() => setLang(code)}
          aria-pressed={lang === code}
        >
          {LABELS[code]}
        </button>
      ))}
    </div>
  );
}
