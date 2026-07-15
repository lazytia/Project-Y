"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { emailToUsername } from "@/lib/username";
import { isChef } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import Splash from "@/components/Splash";
import { useLang } from "@/components/LanguageProvider";
import styles from "./page.module.css";

/** Returns the Wednesday of the calendar week AFTER the given date. */
function getPayrollCutoff(startDate: Date): Date {
  const d = new Date(startDate);
  const dow = d.getDay(); // 0=Sun … 6=Sat
  // Days from d until the next Monday
  const daysToNextMonday = dow === 0 ? 1 : 8 - dow;
  // Wednesday of that next week = next Monday + 2 days
  d.setDate(d.getDate() + daysToNextMonday + 2);
  return d;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const TOTAL_STEPS = 7;

/** Each step keeps a translation KEY instead of a hardcoded English
 *  label so the page can render EN or JA based on the language toggle. */
const ALL_STEPS = [
  { num: 1, labelKey: "onb.steps.personal",  path: "/onboarding/personal-information", icon: "👤" },
  { num: 2, labelKey: "onb.steps.tfn",       path: "/onboarding/tfn-declaration",      icon: "📄" },
  { num: 3, labelKey: "onb.steps.bank",      path: "/onboarding/bank-super-details",   icon: "🏦" },
  { num: 4, labelKey: "onb.steps.documents", path: "/onboarding/documents",            icon: "🪪" },
  { num: 5, labelKey: "onb.steps.policies",  path: "/onboarding/policies",             icon: "📖" },
  { num: 6, labelKey: "onb.steps.review",    path: "/onboarding/review-sign",          icon: "✍️" },
  { num: 7, labelKey: "onb.steps.complete",  path: "/onboarding/complete",             icon: "🎉" },
];

// Circular progress SVG constants
const R = 44;
const CIRC = 2 * Math.PI * R;

export default function OnboardingPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useLang();
  const name = emailToUsername(user?.email ?? "");
  const displayName = name.charAt(0).toUpperCase() + name.slice(1);

  // Chefs skip onboarding entirely — bounce them out immediately.
  useEffect(() => {
    if (user && isChef(user)) router.replace(ROUTES.chefHome);
  }, [user, router]);

  const [completedStep, setCompletedStep] = useState(0);
  // inProgressStep: step they were last WORKING on (including partial Save & Exit)
  const [inProgressStep, setInProgressStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState<Date | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const snap = await getDoc(doc(getDb(), "staff_onboarding", user.uid));
        const today = new Date();
        if (snap.exists()) {
          const data = snap.data();
          const completed = typeof data.completedStep === "number" ? data.completedStep : 0;
          const inProgress = typeof data.step === "number" ? data.step : 0;
          setCompletedStep(completed);
          setInProgressStep(Math.max(completed, inProgress - 1));
          // Use saved startDate or fall back to today
          if (data.startDate?.toDate) {
            setStartDate(data.startDate.toDate());
          } else {
            // First visit — persist today as the start date
            setStartDate(today);
            await setDoc(
              doc(getDb(), "staff_onboarding", user.uid),
              { startDate: serverTimestamp() },
              { merge: true }
            );
          }
        } else {
          // No document yet — persist today as the start date
          setStartDate(today);
          await setDoc(
            doc(getDb(), "staff_onboarding", user.uid),
            { uid: user.uid, startDate: serverTimestamp() },
            { merge: true }
          );
        }
      } catch {
        // silently ignore — default to today
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  // Once every onboarding step is done the staff member's "home" is the
  // completion page, not this overview.
  useEffect(() => {
    if (loading) return;
    if (completedStep >= TOTAL_STEPS) {
      router.replace(ROUTES.staffOnboardingComplete);
    }
  }, [loading, completedStep, router]);
  const isCompleted = completedStep >= TOTAL_STEPS;

  const percent = Math.round((completedStep / TOTAL_STEPS) * 100);
  const offset = CIRC * (1 - percent / 100);
  // "YOUR NEXT STEP" shows the step after the last completed one
  const nextStepIndex = completedStep;
  const nextStep = ALL_STEPS[nextStepIndex] ?? ALL_STEPS[TOTAL_STEPS - 1];
  // "Continue Onboarding" resumes from where they last saved data
  const continueStep = ALL_STEPS[inProgressStep] ?? nextStep;
  const remainingSteps = ALL_STEPS.slice(nextStepIndex + 1);

  const payrollCutoff = startDate ? getPayrollCutoff(startDate) : null;

  // Keep the splash visible for completed staff so the overview UI never
  // flashes before the router.replace above lands on /onboarding/complete.
  if (loading || isCompleted) {
    return <Splash />;
  }

  return (
    <div className={styles.page}>
      {/* Greeting */}
      <div className={styles.greeting}>
        <h1 className={styles.greetingTitle}>{t("onb.welcome")}, {displayName} 👋</h1>
        <p className={styles.greetingSubtitle}>{t("onb.subGreeting")}</p>
      </div>

      {/* Onboarding Overview */}
      <section className={styles.card}>
        <p className={styles.sectionLabel}>{t("onb.overviewHeader")}</p>

        <div className={styles.overviewBody}>
          <div className={styles.overviewDates}>
            <div className={styles.dateRow}>
              <span className={styles.dateIcon}>📅</span>
              <div>
                <p className={styles.dateLabel}>{t("onb.startDate")}</p>
                <p className={styles.dateValue}>{startDate ? fmtDate(startDate) : "—"}</p>
              </div>
            </div>
            <div className={styles.dateRow}>
              <span className={styles.dateIcon}>🕐</span>
              <div>
                <p className={styles.dateLabel}>{t("onb.payrollCutoff")}</p>
                <p className={styles.dateValue}>{payrollCutoff ? fmtDate(payrollCutoff) : "—"}</p>
                <p className={styles.dateSub}>{t("onb.payrollCutoffHelp")}</p>
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
                <span className={styles.progressCountOrange}>{loading ? "—" : completedStep} {t("onb.stepOf")} {TOTAL_STEPS}</span>
              </span>
              <span className={styles.progressCompleted}>{t("onb.completed")}</span>
            </div>
          </div>
        </div>

        <button
          className={styles.continueBtn}
          onClick={() => router.push(continueStep.path)}
          disabled={loading}
        >
          {t("onb.continueOnboarding")} <span className={styles.continueBtnArrow}>›</span>
        </button>
      </section>

      {/* Remaining Items */}
      {remainingSteps.length > 0 && (
        <section className={styles.card}>
          <p className={styles.sectionLabel}>{t("onb.remaining")}</p>
          <ul className={styles.itemList}>
            {remainingSteps.map((step) => (
              <li key={step.labelKey} className={styles.item}>
                <span className={styles.itemIcon}>{step.icon}</span>
                <span className={styles.itemLabel}>{t(step.labelKey)}</span>
                <span className={styles.itemStatus}>{t("onb.pending")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {completedStep >= TOTAL_STEPS && (
        <section className={styles.card}>
          <p className={styles.sectionLabel}>{t("onb.allDone")}</p>
          <p className={styles.allDoneNote}>{t("onb.allDoneMsg")}</p>
        </section>
      )}
    </div>
  );
}
