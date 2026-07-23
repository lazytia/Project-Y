"use client";

import { useRouter } from "next/navigation";
import { useLang } from "@/components/LanguageProvider";
import { BEER_GUIDE_VIDEOS } from "@/lib/beer-guide-videos";
import styles from "./page.module.css";

export default function BeerGuidePage() {
  const router = useRouter();
  const { t } = useLang();

  return (
    <div className={styles.page}>
      <button
        type="button"
        className={styles.backBtn}
        onClick={() => router.push("/onboarding")}
        aria-label={t("common.back")}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        <span>{t("common.back")}</span>
      </button>

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
