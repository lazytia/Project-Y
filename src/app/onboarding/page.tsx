"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { emailToUsername } from "@/lib/username";
import styles from "./page.module.css";

const ONBOARDING_ITEMS = [
  { icon: "📄", label: "TFN Declaration" },
  { icon: "🏦", label: "Bank & Super Details" },
  { icon: "🪪", label: "Passport / Photo ID" },
  { icon: "🌐", label: "Visa" },
  { icon: "🛡", label: "RSA Certificate" },
  { icon: "📖", label: "Staff Handbook" },
  { icon: "🔒", label: "Privacy Policy" },
  { icon: "📄", label: "Employee Agreement" },
];

const TOTAL = ONBOARDING_ITEMS.length;
const COMPLETED = 0;
const PERCENT = Math.round((COMPLETED / TOTAL) * 100);

// Circular progress SVG constants
const R = 44;
const CIRC = 2 * Math.PI * R;
const OFFSET = CIRC * (1 - PERCENT / 100);

export default function OnboardingPage() {
  const router = useRouter();
  const { user } = useAuth();
  const name = emailToUsername(user?.email ?? "");
  const displayName = name.charAt(0).toUpperCase() + name.slice(1);

  return (
    <div className={styles.page}>
      {/* Greeting */}
      <div className={styles.greeting}>
        <h1 className={styles.greetingTitle}>Welcome, {displayName} 👋</h1>
        <p className={styles.greetingSubtitle}>Let&apos;s get you all set up.</p>
      </div>

      {/* Onboarding Overview */}
      <section className={styles.card}>
        <p className={styles.sectionLabel}>ONBOARDING OVERVIEW</p>

        <div className={styles.overviewBody}>
          <div className={styles.overviewDates}>
            <div className={styles.dateRow}>
              <span className={styles.dateIcon}>📅</span>
              <div>
                <p className={styles.dateLabel}>Start Date</p>
                <p className={styles.dateValue}>Mon, 15 Jun 2026</p>
              </div>
            </div>
            <div className={styles.dateRow}>
              <span className={styles.dateIcon}>🕐</span>
              <div>
                <p className={styles.dateLabel}>Payroll Cut-off</p>
                <p className={styles.dateValue}>Wed, 17 Jun 2026</p>
                <p className={styles.dateSub}>
                  Submit by this date to be paid in the following week.
                </p>
              </div>
            </div>
          </div>

          <div className={styles.progressWrap}>
            <svg className={styles.progressRing} viewBox="0 0 100 100">
              <circle
                cx="50" cy="50" r={R}
                fill="none"
                stroke="var(--color-surface)"
                strokeWidth="8"
              />
              <circle
                cx="50" cy="50" r={R}
                fill="none"
                stroke="var(--color-warm)"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={CIRC}
                strokeDashoffset={OFFSET}
                transform="rotate(-90 50 50)"
              />
            </svg>
            <div className={styles.progressInner}>
              <span className={styles.progressPct}>{PERCENT}%</span>
            </div>
            <div className={styles.progressMeta}>
              <span className={styles.progressCount}>
                <span className={styles.progressCountOrange}>{COMPLETED} of {TOTAL}</span>
              </span>
              <span className={styles.progressCompleted}>Completed</span>
            </div>
          </div>
        </div>

        <button
          className={styles.continueBtn}
          onClick={() => router.push("/onboarding/personal-information")}
        >
          Continue Onboarding <span className={styles.continueBtnArrow}>›</span>
        </button>
      </section>

      {/* Next Step */}
      <section className={styles.card}>
        <p className={styles.sectionLabel}>YOUR NEXT STEP</p>
        <div className={styles.nextStepRow}>
          <div className={styles.nextStepIcon}>
            <span>👤</span>
          </div>
          <div className={styles.nextStepInfo}>
            <p className={styles.nextStepTitle}>Personal Information</p>
            <p className={styles.nextStepDesc}>Add your personal details</p>
            <p className={styles.nextStepTime}>🕐 Est. 2 mins</p>
          </div>
          <button className={styles.startBtn}>Start</button>
        </div>
      </section>

      {/* Remaining Items */}
      <section className={styles.card}>
        <p className={styles.sectionLabel}>REMAINING ITEMS</p>
        <ul className={styles.itemList}>
          {ONBOARDING_ITEMS.map((item) => (
            <li key={item.label} className={styles.item}>
              <span className={styles.itemIcon}>{item.icon}</span>
              <span className={styles.itemLabel}>{item.label}</span>
              <span className={styles.itemStatus}>Pending</span>
              <span className={styles.itemChevron}>›</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
