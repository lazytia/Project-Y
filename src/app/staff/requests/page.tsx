"use client";

import Link from "next/link";
import { useLang } from "@/components/LanguageProvider";
import styles from "./page.module.css";

/** Shared geometry for the row icons, so one edit moves both. */
const ICON_PROPS = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/**
 * The two things a staff member can ask the owner for.
 *
 * Both forms already existed and already had a home under the sidebar's
 * Schedule group; this page is what replaces that group now the menu is flat.
 * Labels reuse the `nav.*` keys the rows carried there, so the wording only
 * has to be corrected in one place.
 */
const REQUEST_LINKS: readonly { href: string; labelKey: string; icon: React.ReactNode }[] = [
  {
    href: "/staff/schedule/request-holiday",
    labelKey: "nav.requestHoliday",
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
    labelKey: "nav.availabilityChange",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
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

      {REQUEST_LINKS.map(({ href, labelKey, icon }) => (
        <Link href={href} key={href} className={styles.row}>
          <span className={styles.rowIcon} aria-hidden="true">
            {icon}
          </span>
          <span className={styles.rowLabel}>{t(labelKey)}</span>
          <span className={styles.chevron} aria-hidden="true">
            ›
          </span>
        </Link>
      ))}
    </div>
  );
}
