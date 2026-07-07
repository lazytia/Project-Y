"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { ROUTES } from "@/lib/routes";
import { registerFcmToken } from "@/lib/fcm";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

/**
 * First screen a newly-invited staff member sees. Blocks progress into
 * the actual onboarding form until they accept the notification prompt
 * so we can push their roster, payslips, and company updates.
 *
 * Once they hit "Enable Notifications" we:
 *   1. Trigger the browser permission prompt through registerFcmToken.
 *   2. On grant: mark notificationsPromptSeen + notificationsGranted on
 *      their staff_onboarding doc, then hop into /onboarding.
 *   3. On deny: keep them on this page — the copy explains they need
 *      to accept before they can continue.
 */

export default function NotificationsPromptPage() {
  const router = useRouter();
  const { user, loading: authLoading, staffCompletedStep } = useAuth();

  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);

  // Once the prompt has been accepted (or was previously accepted in a
  // past session), we skip straight to the onboarding checklist. Owner
  // and chef never see this page — AuthProvider bounces them elsewhere.
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace(ROUTES.login);
      return;
    }
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      router.replace(ROUTES.staffOnboarding);
    }
  }, [authLoading, user, router]);

  async function handleEnable() {
    if (!user || busy) return;
    setBusy(true);
    setDenied(false);
    try {
      const token = await registerFcmToken(user.uid);
      // Record what happened either way so we don't nag on every visit.
      await setDoc(
        doc(getDb(), "staff_onboarding", user.uid),
        {
          notificationsPromptSeen: true,
          notificationsGranted: token !== null,
          notificationsPromptedAt: serverTimestamp(),
        },
        { merge: true },
      );
      if (token) {
        router.replace(ROUTES.staffOnboarding);
      } else {
        // Either they denied the prompt or the browser doesn't support
        // push. Keep them on this page — the copy tells them why.
        setDenied(true);
      }
    } finally {
      setBusy(false);
    }
  }

  if (authLoading) return <Splash />;
  if (!user) return <Splash label="Redirecting…" />;
  // Skip past this page if they've already finished their real onboarding.
  if (staffCompletedStep !== null && staffCompletedStep >= 7) {
    router.replace(ROUTES.staffHome);
    return <Splash />;
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.brand}>PROJECT <span className={styles.brandAccent}>Y</span></span>
      </header>

      <div className={styles.bellWrap} aria-hidden="true">
        <div className={styles.bellHalo}>
          <span className={styles.bell}>🔔</span>
          <span className={styles.bellCheck}>✓</span>
        </div>
      </div>

      <h1 className={styles.title}>Enable Notifications</h1>
      <p className={styles.subtitle}>
        Stay up to date with important updates from Project Y.
      </p>

      <ul className={styles.reasons}>
        <li className={styles.reason}>
          <span className={styles.reasonIcon} aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </span>
          <span>New roster published</span>
        </li>
        <li className={styles.reason}>
          <span className={styles.reasonIcon} aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </span>
          <span>Roster changes</span>
        </li>
        <li className={styles.reason}>
          <span className={styles.reasonIcon} aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <polyline points="12 7 12 12 15 14" />
            </svg>
          </span>
          <span>Shift reminders</span>
        </li>
        <li className={styles.reason}>
          <span className={styles.reasonIcon} aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 11l18-5v12L3 13v-2z" />
              <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
            </svg>
          </span>
          <span>Important company announcements</span>
        </li>
      </ul>

      <p className={styles.trustLine}>
        <span aria-hidden="true">🛡️</span>{" "}
        We will only send you relevant updates. You can change this anytime in settings.
      </p>

      {denied && (
        <p className={styles.deniedBanner}>
          Notifications are required to continue. Please allow the prompt in your browser or check your device settings, then try again.
        </p>
      )}

      <button
        type="button"
        className={styles.enableBtn}
        onClick={() => void handleEnable()}
        disabled={busy}
      >
        <span aria-hidden="true">🔔</span>{" "}
        {busy ? "Enabling…" : "Enable Notifications"}
      </button>
    </div>
  );
}
