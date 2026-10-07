"use client";

import Link from "next/link";
import { useLang } from "@/components/LanguageProvider";
import { useBackTo } from "@/hooks/useBackTo";
import { CLOCK_IN_GUIDE_HREF } from "@/lib/clock-in-guide";
import { ROUTES } from "@/lib/routes";
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
 * Other Training Materials — the guides that are not the handbook, the beer
 * guide or the food safety rules.
 *
 * The clock-in guide lives here for a specific reason. The staff dashboard
 * promotes it for the first fortnight after activation and then drops the
 * card, so once the menu stopped carrying it there was no way back to it for
 * anybody who had been on the team longer than two weeks — and it is the one
 * document somebody reaches for precisely when they have forgotten how the
 * POS works, which is rarely in their first fortnight.
 */
const MATERIAL_LINKS: readonly {
  href: string;
  labelKey: string;
  descKey: string;
  icon: React.ReactNode;
}[] = [
  {
    href: "/staff/training-manual",
    labelKey: "nav.trainingManual",
    descKey: "docs.materials.manualDesc",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
  },
  {
    href: CLOCK_IN_GUIDE_HREF,
    labelKey: "nav.clockInGuide",
    descKey: "docs.materials.clockInDesc",
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="12" cy="12" r="9" />
        <polyline points="12 7 12 12 15.5 14" />
      </svg>
    ),
  },
];

export default function TrainingMaterialsPage() {
  const { t } = useLang();
  // Back to Documents & Training — this list is one of its five rows.
  const goBack = useBackTo(ROUTES.staffDocuments);

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

      <h1 className={styles.title}>{t("docs.hub.otherTraining")}</h1>
      <p className={styles.subtitle}>{t("docs.hub.otherTrainingDesc")}</p>

      {MATERIAL_LINKS.map(({ href, labelKey, descKey, icon }) => (
        <Link href={href} key={href} className={styles.card}>
          <span className={styles.cardIcon} aria-hidden="true">
            {icon}
          </span>
          <span className={styles.cardBody}>
            <span className={styles.cardTitle}>{t(labelKey)}</span>
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
