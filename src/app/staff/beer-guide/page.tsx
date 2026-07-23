"use client";

import { useLang } from "@/components/LanguageProvider";
import { BEER_GUIDE_VIDEOS } from "@/lib/beer-guide-videos";
import styles from "./page.module.css";

export default function BeerGuidePage() {
  const { t } = useLang();

  return (
    <div className={styles.page}>
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
    </div>
  );
}
