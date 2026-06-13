"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { registerFcmToken } from "@/lib/fcm";
import { useAuth } from "@/components/AuthProvider";
import { emailToUsername } from "@/lib/username";
import Splash from "@/components/Splash";
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
  const [startDate, setStartDate] = useState<Date>(new Date());

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

  // Notification permission state — iOS only fires the system prompt when
  // requestPermission() is called inside a user-gesture handler, so we expose
  // an explicit "Enable Notifications" button below.
  const [notifPerm, setNotifPerm] = useState<NotificationPermission | "unsupported">(
    "default",
  );
  const [registeringNotif, setRegisteringNotif] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) {
      setNotifPerm("unsupported");
    } else {
      setNotifPerm(Notification.permission);
    }
  }, []);

  async function handleEnableNotifications() {
    if (!user) return;
    setRegisteringNotif(true);
    try {
      const token = await registerFcmToken(user.uid);
      // Re-read permission state so the UI updates whether the user allowed or denied.
      if (typeof window !== "undefined" && "Notification" in window) {
        setNotifPerm(Notification.permission);
      }
      if (!token) {
        console.warn("[onboarding] FCM token not obtained");
      }
    } catch (err) {
      console.error("[onboarding] registerFcmToken failed", err);
    } finally {
      setRegisteringNotif(false);
    }
  }

  const percent = Math.round((completedStep / TOTAL_STEPS) * 100);
  const offset = CIRC * (1 - percent / 100);
  // "YOUR NEXT STEP" shows the step after the last completed one
  const nextStepIndex = completedStep;
  const nextStep = ALL_STEPS[nextStepIndex] ?? ALL_STEPS[TOTAL_STEPS - 1];
  // "Continue Onboarding" resumes from where they last saved data
  const continueStep = ALL_STEPS[inProgressStep] ?? nextStep;
  const remainingSteps = ALL_STEPS.slice(nextStepIndex + 1);

  const payrollCutoff = getPayrollCutoff(startDate);

  if (loading) {
    return <Splash />;
  }

  return (
    <div className={styles.page}>
      {/* Greeting */}
      <div className={styles.greeting}>
        <h1 className={styles.greetingTitle}>Welcome, {displayName} 👋</h1>
        <p className={styles.greetingSubtitle}>Let&apos;s get you all set up.</p>
      </div>

      {/* Notification permission prompt — iOS only shows the system dialog
          from a user-gesture handler, so we expose it as an explicit button. */}
      {notifPerm === "default" && (
        <section className={styles.notifCard}>
          <div className={styles.notifBody}>
            <p className={styles.notifTitle}>🔔 Enable Notifications</p>
            <p className={styles.notifSub}>
              Allow notifications so your manager can remind you about pending
              onboarding tasks.
            </p>
          </div>
          <button
            type="button"
            className={styles.notifBtn}
            onClick={handleEnableNotifications}
            disabled={registeringNotif}
          >
            {registeringNotif ? "…" : "Enable"}
          </button>
        </section>
      )}
      {notifPerm === "denied" && (
        <section className={styles.notifCardWarn}>
          <p className={styles.notifTitle}>🔕 Notifications blocked</p>
          <p className={styles.notifSub}>
            Open iPhone Settings → Notifications → Project Y and turn on
            &quot;Allow Notifications&quot; to receive reminders.
          </p>
        </section>
      )}

      {/* Onboarding Overview */}
      <section className={styles.card}>
        <p className={styles.sectionLabel}>ONBOARDING OVERVIEW</p>

        <div className={styles.overviewBody}>
          <div className={styles.overviewDates}>
            <div className={styles.dateRow}>
              <span className={styles.dateIcon}>📅</span>
              <div>
                <p className={styles.dateLabel}>Start Date</p>
                <p className={styles.dateValue}>{fmtDate(startDate)}</p>
              </div>
            </div>
            <div className={styles.dateRow}>
              <span className={styles.dateIcon}>🕐</span>
              <div>
                <p className={styles.dateLabel}>Payroll Cut-off</p>
                <p className={styles.dateValue}>{fmtDate(payrollCutoff)}</p>
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
