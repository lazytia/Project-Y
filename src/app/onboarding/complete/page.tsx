"use client";

import { useEffect, useState } from "react";
import { doc, getDoc, type Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import Splash from "@/components/Splash";
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

export default function OnboardingCompletePage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState<Date | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const snap = await getDoc(doc(getDb(), "staff_onboarding", user.uid));
        const data = snap.data() ?? {};
        setStartDate(tsToDate(data.startDate));
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  if (loading) return <Splash />;

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <div className={styles.iconWrap} aria-hidden="true">
          <span className={styles.sparkleA} />
          <span className={styles.sparkleB} />
          <span className={styles.sparkleC} />
          <span className={styles.sparkleD} />
          <span className={styles.sparkleE} />
          <span className={styles.sparkleF} />
          <div className={styles.iconCircle}>
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="14" y="10" width="32" height="44" rx="3" />
              <path d="M22 6h16a2 2 0 0 1 2 2v4H20V8a2 2 0 0 1 2-2z" />
              <circle cx="42" cy="36" r="11" fill="#fff" />
              <polyline points="37 36 41 40 47 32" />
            </svg>
          </div>
        </div>

        <h1 className={styles.title}>Onboarding Submitted!</h1>
        <p className={styles.subtitle}>
          Thank you! Your onboarding has been submitted and is now under
          review.
        </p>
      </div>

      <section className={styles.infoCard}>
        <div className={styles.infoIcon} aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </div>
        <p className={styles.infoBody}>
          We&apos;ll review your information and documents. You will receive a
          notification once your profile has been approved.
        </p>
      </section>

      <div className={styles.statRow}>
        <div className={styles.statCard}>
          <div className={styles.statIcon} aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </div>
          <p className={styles.statLabel}>Start Date</p>
          <p className={styles.statValue}>{fmtDate(startDate)}</p>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statIcon} aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <p className={styles.statLabel}>Status</p>
          <span className={styles.statusBadge}>Under Review</span>
        </div>
      </div>
    </div>
  );
}
