"use client";

import { useEffect, useState } from "react";
import { doc, getDoc, type Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { useLang } from "@/components/LanguageProvider";
import StaffHandbookDocument, {
  HANDBOOK_UPDATED,
  HANDBOOK_VERSION,
} from "@/components/StaffHandbookDocument";
import Splash from "@/components/Splash";
import handbookStyles from "@/app/onboarding/policies/staff-handbook/page.module.css";
import styles from "./page.module.css";

function tsToDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object" && v !== null && "toDate" in v) {
    return (v as Timestamp).toDate();
  }
  return null;
}

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

type HandbookPolicies = {
  handbookSignedAt?: Timestamp;
  handbookVersion?: string;
  handbookSignature?: string;
};

export default function StaffHandbookPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const [loading, setLoading] = useState(true);
  const [policies, setPolicies] = useState<HandbookPolicies | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const snap = await getDoc(doc(getDb(), "staff_onboarding", user.uid));
        const data = snap.data() ?? {};
        setPolicies((data.policies ?? {}) as HandbookPolicies);
      } catch {
        setPolicies(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  if (loading) return <Splash />;

  const signedAt = tsToDate(policies?.handbookSignedAt);
  const signature = policies?.handbookSignature ?? null;
  const version = policies?.handbookVersion ?? HANDBOOK_VERSION;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t("nav.staffHandbook")}</h1>
        <p className={styles.subtitle}>{t("staff.handbook.subtitle")}</p>
      </header>

      <div className={handbookStyles.page}>
        <StaffHandbookDocument />

        <section className={handbookStyles.section}>
          <h2 className={handbookStyles.ackTitle}>{t("onb.pol.hb.ack.title")}</h2>
          <div className={handbookStyles.ackUnderline} />
          <p className={handbookStyles.ackBody}>{t("onb.pol.hb.ack.body")}</p>

          <div className={handbookStyles.signatureBlock}>
            <span className={handbookStyles.signatureLabel}>
              {t("onb.pol.signatureIntroHandbook")}
            </span>
            {signature ? (
              <div className={handbookStyles.signaturePreview}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={signature}
                  alt="Your signature"
                  className={handbookStyles.signatureImg}
                />
              </div>
            ) : (
              <p className={styles.unsigned}>{t("staff.handbook.notSigned")}</p>
            )}
          </div>

          <div className={handbookStyles.metaRow}>
            <div className={handbookStyles.metaItem}>
              <span>{t("onb.pol.hb.meta.version")}</span>
              <span>{version}</span>
            </div>
            <div className={handbookStyles.metaItem}>
              <span>{t("onb.pol.hb.meta.updated")}</span>
              <span>{HANDBOOK_UPDATED}</span>
            </div>
            <div className={handbookStyles.metaItem}>
              <span>{t("staff.handbook.signedOn")}</span>
              <span>{fmtDate(signedAt)}</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
