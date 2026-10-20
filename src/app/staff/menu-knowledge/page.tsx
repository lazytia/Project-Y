"use client";

import { useLang } from "@/components/LanguageProvider";
import { useBackTo } from "@/hooks/useBackTo";
import { MENU_PAGES, MENU_PAGES_DIR } from "@/lib/menu-pages";
import { ROUTES } from "@/lib/routes";
import styles from "./page.module.css";

/**
 * Menu Knowledge — the whole menu, page by page, for the team to learn.
 *
 * The pages are the printed menu as images (see lib/menu-pages for how to add
 * one). While there are none it says the menu is coming, which is the state it
 * was built in: the card on Handbook & Training has to open somewhere.
 */
export default function MenuKnowledgePage() {
  const { t } = useLang();
  // Back to the list this was opened from, not the dashboard — see useBackTo.
  const goBack = useBackTo(ROUTES.staffHandbookTraining);

  return (
    <div className={styles.page}>
      <button
        type="button"
        className={styles.backBtn}
        onClick={goBack}
        aria-label={t("common.back")}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        <span>{t("common.back")}</span>
      </button>

      <h1 className={styles.title}>{t("docs.hub.menuKnowledge")}</h1>

      {MENU_PAGES.length === 0 ? (
        <p className={styles.empty}>{t("docs.menu.comingSoon")}</p>
      ) : (
        MENU_PAGES.map((file, i) => (
          // The menu is long and phone-sized: only the pages being scrolled to
          // are fetched.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={file}
            src={`${MENU_PAGES_DIR}/${file}`}
            alt={t("docs.menu.pageOf")
              .replace("{n}", String(i + 1))
              .replace("{total}", String(MENU_PAGES.length))}
            className={styles.menuPage}
            loading={i === 0 ? "eager" : "lazy"}
            decoding="async"
          />
        ))
      )}
    </div>
  );
}
