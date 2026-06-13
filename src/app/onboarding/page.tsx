"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { emailToUsername } from "@/lib/username";
import styles from "./page.module.css";

const TOTAL_STEPS = 7;

const ALL_STEPS = [
  { num: 1, label: "Personal Information",  path: "/onboarding/personal-information", icon: "👤", desc: "Add your personal details",         time: "Est. 2 mins" },
  { num: 2, label: "TFN Declaration",        path: "/onboarding/tfn-declaration",       icon: "📄", desc: "Submit your tax file number",        time: "Est. 3 mins" },
  { num: 3, label: "Bank & Super Details",   path: "/onboarding/bank-super-details",    icon: "🏦", desc: "Add your bank and super details",    time: "Est. 2 mins" },
  { num: 4, label: "Documents",              path: "/onboarding/documents",             icon: "🪪", desc: "Upload required documents",          time: "Est. 5 mins" },
  { num: 5, label: "Policies",               path: "/onboarding/policies",              icon: "📖", desc: "Read and acknowledge policies",       time: "Est. 3 mins" },
  { num: 6, label: "Review & Sign",          path: "/onboarding/review-sign",           icon: "✍️", desc: "Review and sign your documents",     time: "Est. 2 mins" },
  { num: 7, label: "Complete",               path: "/onboarding/complete",              icon: "🎉", desc: "You are all set!",                   time: "" },
];

// Circular progress SVG constants
const R = 44;
const CIRC = 2 * Math.PI * R;

export default function OnboardingPage() {
  const router = useRouter();
  const { user } = useAuth();
  const name = emailToUsername(user?.email ?? "");
  const displayName = name.charAt(0).toUpperCase() + name.slice(1);

  const [completedStep, setCompletedStep] = useState(0);
  // inProgressStep: step they were last WORKING on (including partial Save & Exit)
  const [inProgressStep, setInProgressStep] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const snap = await getDoc(doc(getDb(), "staff_onboarding", user.uid));
        if (snap.exists()) {
          const data = snap.data();
          const completed = typeof data.completedStep === "number" ? data.completedStep : 0;
          const inProgress = typeof data.step === "number" ? data.step : 0;
          setCompletedStep(completed);
          // Continue Onboarding lands on the further of the two
          setInProgressStep(Math.max(completed, inProgress - 1));
        }
      } catch {
        // silently ignore — default to 0
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  const percent = Math.round((completedStep / TOTAL_STEPS) * 100);
  const offset = CIRC * (1 - percent / 100);
  // "YOUR NEXT STEP" shows the step after the last completed one
  const nextStepIndex = completedStep;
  const nextStep = ALL_STEPS[nextStepIndex] ?? ALL_STEPS[TOTAL_STEPS - 1];
  // "Continue Onboarding" resumes from where they last saved data
  const continueStep = ALL_STEPS[inProgressStep] ?? nextStep;
  const remainingSteps = ALL_STEPS.slice(nextStepIndex + 1);

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
            <div className={styles.progressRingWrap}>
              <svg className={styles.progressRing} viewBox="0 0 100 100">
                <circle cx="50" cy="50" r={R} fill="none" stroke="var(--color-surface)" strokeWidth="8" />
                <circle
                  cx="50" cy="50" r={R}
                  fill="none"
                  stroke={loading ? "var(--color-surface)" : "var(--color-warm)"}
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={CIRC}
                  strokeDashoffset={offset}
                  transform="rotate(-90 50 50)"
                />
              </svg>
              <div className={styles.progressInner}>
                <span className={styles.progressPct}>{loading ? "—" : `${percent}%`}</span>
              </div>
            </div>
            <div className={styles.progressMeta}>
              <span className={styles.progressCount}>
                <span className={styles.progressCountOrange}>{loading ? "—" : completedStep} of {TOTAL_STEPS}</span>
              </span>
              <span className={styles.progressCompleted}>Completed</span>
            </div>
          </div>
        </div>

        <button
          className={styles.continueBtn}
          onClick={() => router.push(continueStep.path)}
          disabled={loading}
        >
          Continue Onboarding <span className={styles.continueBtnArrow}>›</span>
        </button>
      </section>

      {/* Next Step */}
      <section className={styles.card}>
        <p className={styles.sectionLabel}>YOUR NEXT STEP</p>
        <div className={styles.nextStepRow}>
          <div className={styles.nextStepIcon}>
            <span>{nextStep.icon}</span>
          </div>
          <div className={styles.nextStepInfo}>
            <p className={styles.nextStepTitle}>{nextStep.label}</p>
            <p className={styles.nextStepDesc}>{nextStep.desc}</p>
            {nextStep.time && <p className={styles.nextStepTime}>🕐 {nextStep.time}</p>}
          </div>
          <button className={styles.startBtn} onClick={() => router.push(nextStep.path)}>
            {completedStep > 0 ? "Continue" : "Start"}
          </button>
        </div>
      </section>

      {/* Remaining Items */}
      {remainingSteps.length > 0 && (
        <section className={styles.card}>
          <p className={styles.sectionLabel}>REMAINING ITEMS</p>
          <ul className={styles.itemList}>
            {remainingSteps.map((step) => (
              <li key={step.label} className={styles.item}>
                <span className={styles.itemIcon}>{step.icon}</span>
                <span className={styles.itemLabel}>{step.label}</span>
                <span className={styles.itemStatus}>Pending</span>
                <span className={styles.itemChevron}>›</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {completedStep >= TOTAL_STEPS && (
        <section className={styles.card}>
          <p className={styles.sectionLabel}>ALL DONE 🎉</p>
          <p className={styles.allDoneNote}>
            You have completed all onboarding steps. Welcome to the team!
          </p>
        </section>
      )}
    </div>
  );
}
