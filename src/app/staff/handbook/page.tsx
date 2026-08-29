"use client";

import { useRouter } from "next/navigation";
import { useLang } from "@/components/LanguageProvider";
import DocumentAcknowledgement from "@/components/DocumentAcknowledgement";
import StaffHandbookDocument from "@/components/StaffHandbookDocument";
import { HANDBOOK_UPDATED, HANDBOOK_VERSION } from "@/lib/hr-documents";
import handbookStyles from "@/app/onboarding/policies/staff-handbook/page.module.css";
import styles from "./page.module.css";

export default function StaffHandbookPage() {
  const router = useRouter();
  const { t } = useLang();

  return (
    <div className={styles.page}>
      <button
        type="button"
        className={styles.backBtn}
        onClick={() => router.back()}
        aria-label={t("common.back")}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        <span>{t("common.back")}</span>
      </button>

      <header className={styles.header}>
        <h1 className={styles.title}>{t("nav.staffHandbook")}</h1>
        <p className={styles.subtitle}>{t("staff.handbook.subtitle")}</p>
      </header>

      <div className={handbookStyles.page}>
        <StaffHandbookDocument />

        <DocumentAcknowledgement
          documentKey="handbook"
          version={HANDBOOK_VERSION}
          updated={HANDBOOK_UPDATED}
          bodyKey="doc.ack.body.handbook"
        />
      </div>
    </div>
  );
}
