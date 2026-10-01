"use client";

/**
 * The Beer Guide itself — the training videos, and nothing about
 * acknowledging them.
 *
 * Shared by the onboarding step where a new hire signs it and the copy staff
 * open from the sidebar, for the same reason the handbook next door is
 * shared: one list, so a video added or reordered shows up in both places and
 * "video 3" means the same thing to everybody.
 *
 * The back button stays with each page — one returns to the dashboard, the
 * other to the policies checklist — and so does the signing block.
 */

import { useLang } from "@/components/LanguageProvider";
import { BEER_GUIDE_VIDEOS } from "@/lib/beer-guide-videos";
import styles from "@/app/staff/beer-guide/page.module.css";

export default function BeerGuideDocument() {
  const { t } = useLang();

  return (
    <>
      <header className={styles.header}>
        <h1 className={styles.title}>{t("nav.beerGuide")}</h1>
        <p className={styles.subtitle}>{t("staff.beerGuide.subtitle")}</p>
      </header>

      <ol className={styles.list}>
        {BEER_GUIDE_VIDEOS.map((video, index) => (
          <li key={video.src} className={styles.item}>
            <h2 className={styles.videoTitle}>
              <span className={styles.videoNum}>{index + 1}</span>
              {t(video.titleKey)}
            </h2>
            <div className={styles.videoWrap}>
              <video
                className={styles.video}
                src={video.src}
                controls
                playsInline
                preload="metadata"
              />
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}
