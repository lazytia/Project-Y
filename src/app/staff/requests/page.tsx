"use client";

import Link from "next/link";
import { useLang } from "@/components/LanguageProvider";
import styles from "./page.module.css";

/** Shared geometry for the card icons, so one edit moves both. */
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
 * The two things a staff member can ask the owner for.
 *
 * Both forms already existed and hung off the sidebar's Schedule group; this
 * page is what replaced that group when the menu went flat. Titles reuse the
 * `nav.*` keys the rows carried there, so the wording is corrected once.
 */
const REQUEST_CARDS: readonly {
  href: string;
  titleKey: string;
  descKey: string;
  icon: React.ReactNode;
}[] = [
  {
    href: "/staff/schedule/request-holiday",
    titleKey: "nav.requestHoliday",
    descKey: "req.holidayDesc",
    icon: (
      <svg {...ICON_PROPS}>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    href: "/staff/schedule/availability-change",
    titleKey: "nav.availabilityChange",
    descKey: "req.availabilityDesc",
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="12" cy="12" r="9" />
        <polyline points="12 7 12 12 15.5 14" />
      </svg>
    ),
  },
];

export default function StaffRequestsPage() {
  const { t } = useLang();

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t("req.title")}</h1>
      <p className={styles.subtitle}>{t("req.subtitle")}</p>

      {REQUEST_CARDS.map(({ href, titleKey, descKey, icon }) => (
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

      <div className={styles.infoBox}>
        <span className={styles.infoIcon} aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </span>
        <p className={styles.infoBody}>{t("req.note")}</p>
      </div>
    </div>
  );
}
