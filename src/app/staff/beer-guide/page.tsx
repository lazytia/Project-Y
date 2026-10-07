"use client";

import { useLang } from "@/components/LanguageProvider";
import BeerGuideDocument from "@/components/BeerGuideDocument";
import DocumentAcknowledgement from "@/components/DocumentAcknowledgement";
import { useBackTo } from "@/hooks/useBackTo";
import { BEER_GUIDE_UPDATED, BEER_GUIDE_VERSION } from "@/lib/hr-documents";
import { ROUTES } from "@/lib/routes";
import styles from "./page.module.css";

export default function BeerGuidePage() {
  // Back to the list this was opened from, not the dashboard — see useBackTo.
  const goBack = useBackTo(ROUTES.staffDocuments);
  const { t } = useLang();

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

      <BeerGuideDocument />

      <DocumentAcknowledgement
        documentKey="beerGuide"
        version={BEER_GUIDE_VERSION}
        updated={BEER_GUIDE_UPDATED}
        bodyKey="doc.ack.body.beerGuide"
      />
    </div>
  );
}
