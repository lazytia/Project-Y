"use client";

import Link from "next/link";
import { useLang } from "@/components/LanguageProvider";
import { useBackToDashboard } from "@/hooks/useBackToDashboard";
import { ROUTES } from "@/lib/routes";
import styles from "./page.module.css";

/** Shared geometry for the card icons, so one edit moves all of them. */
const ICON_PROPS = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/**
 * What the menu's "Handbook & Training" opens: the things an employee is asked
 * to read, in the order they are asked.
 *
 * It replaced two screens. The menu used to open a sub-menu of three documents,
 * and a "Documents & Training" list sat behind the dashboard tile; one page
 * that lists them all is a single tap from the menu and needs no sub-menu.
 */
const HUB_CARDS: readonly {
  href: string;
  titleKey: string;
  descKey: string;
  icon: React.ReactNode;
}[] = [
  {
    href: ROUTES.staffHandbook,
    titleKey: "nav.staffHandbook",
    descKey: "docs.hub.handbookDesc",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="8" y1="13" x2="16" y2="13" />
        <line x1="8" y1="17" x2="13" y2="17" />
      </svg>
    ),
  },
  {
    href: ROUTES.staffMenuKnowledge,
    titleKey: "docs.hub.menuKnowledge",
    descKey: "docs.hub.menuKnowledgeDesc",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M7 2v9a2 2 0 0 0 2 2v9" />
        <path d="M11 2v7M4 2v7a3 3 0 0 0 3 3" />
        <path d="M18 2c-1.5 2-2 4-2 7h4c0-3-.5-5-2-7z" />
        <path d="M18 9v13" />
      </svg>
    ),
  },
  {
    href: ROUTES.staffServiceEssentials,
    titleKey: "docs.hub.serviceEssentials",
    descKey: "docs.hub.serviceEssentialsDesc",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M12 3l8 3v6c0 4.5-3.2 8.2-8 9-4.8-.8-8-4.5-8-9V6z" />
        <polyline points="8.5 12 11 14.5 15.5 9.5" />
      </svg>
    ),
  },
  {
    href: ROUTES.staffBeerGuide,
    titleKey: "nav.beerGuide",
    descKey: "docs.hub.beerDesc",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M17 11h1a3 3 0 0 1 0 6h-1" />
        <path d="M9 12v6M13 12v6" />
        <path d="M5 8h12v10a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z" />
        <path d="M5 8V6a3 3 0 0 1 6 0" />
      </svg>
    ),
  },
];

export default function HandbookTrainingPage() {
  const { t } = useLang();
  // Opened from the menu, which sits under the dashboard.
  const goBack = useBackToDashboard();

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

      <h1 className={styles.title}>{t("nav.handbookTraining")}</h1>

      <div className={styles.notice}>
        <span className={styles.noticeIcon} aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="8" y1="13" x2="16" y2="13" />
            <line x1="8" y1="17" x2="13" y2="17" />
          </svg>
        </span>
        <div className={styles.noticeBody}>
          <p className={styles.noticeTitle}>{t("docs.hub.noticeA")}</p>
          <p className={styles.noticeText}>{t("docs.hub.noticeB")}</p>
        </div>
      </div>

      {HUB_CARDS.map(({ href, titleKey, descKey, icon }) => (
        <Link href={href} key={href} className={styles.card}>
          <span className={styles.cardIcon} aria-hidden="true">
            {icon}
          </span>
          <span className={styles.cardBody}>
            <span className={styles.cardTitle}>{t(titleKey)}</span>
            <span className={styles.cardDesc}>{t(descKey)}</span>
          </span>
          <span className={styles.chevron} aria-hidden="true">
            ›
          </span>
        </Link>
      ))}
    </div>
  );
}
