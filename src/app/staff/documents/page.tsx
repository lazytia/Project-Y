"use client";

import Link from "next/link";
import { useLang } from "@/components/LanguageProvider";
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
 * Everything this screen hands out, in the order it is handed out.
 *
 * The last row is the odd one: the four above it are read, and "My Documents"
 * is where a visa or an RSA is uploaded. It is kept because this app has no
 * other route to that form — the owner's own employee screen cannot replace a
 * document either — so dropping it would leave a staff member whose visa has
 * just been renewed with nowhere to put the new one.
 */
const DOCUMENT_CARDS: readonly {
  href: string;
  titleKey: string;
  descKey: string;
  icon: React.ReactNode;
}[] = [
  {
    href: "/staff/handbook",
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
    href: "/staff/beer-guide",
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
  {
    href: "/staff/food-safety",
    titleKey: "docs.hub.foodSafety",
    descKey: "docs.hub.foodSafetyDesc",
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
    href: "/staff/training-materials",
    titleKey: "docs.hub.otherTraining",
    descKey: "docs.hub.otherTrainingDesc",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
      </svg>
    ),
  },
  {
    href: "/staff/documents/uploads",
    titleKey: "docs.title",
    descKey: "docs.hub.myDocsDesc",
    icon: (
      <svg {...ICON_PROPS}>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <circle cx="12" cy="10" r="3" />
        <path d="M8.5 17h7" />
      </svg>
    ),
  },
];

export default function StaffDocumentsPage() {
  const { t } = useLang();

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t("docs.hub.title")}</h1>
      <p className={styles.subtitle}>{t("docs.hub.subtitle")}</p>

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

      {DOCUMENT_CARDS.map(({ href, titleKey, descKey, icon }) => (
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
