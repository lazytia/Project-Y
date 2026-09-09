"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { useLang } from "@/components/LanguageProvider";
import LanguageToggle from "@/components/LanguageToggle";
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

/** Shared by every row so the icons stay one visual set. */
const ICON_PROPS = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/**
 * What we will actually push them about, in the order they will meet it:
 * next week's roster before the week starts, a reminder before each shift,
 * the answer to a holiday request, pay after the week is worked, training
 * they have been assigned, and announcements as the catch-all.
 *
 * A list rather than six near-identical <li> blocks — the rows differ only
 * by icon and label, and the copy that used to be duplicated around each one
 * is where a sixth row would have gone wrong.
 *
 * Six, not the previous five: "new roster published" and "roster changes"
 * were two rows for one thing, and the two notifications nobody had listed —
 * the reply to a holiday request, and a newly assigned policy or training —
 * are the two people actually ask about.
 */
const REASONS: readonly { labelKey: string; icon: ReactNode }[] = [
  {
    labelKey: "notif.reason.nextWeekRoster",
    icon: (
      <svg {...ICON_PROPS}>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    labelKey: "notif.reason.shiftReminders",
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="12" cy="12" r="9" />
        <polyline points="12 7 12 12 15 14" />
      </svg>
    ),
  },
  {
    labelKey: "notif.reason.holidayRequests",
    icon: (
      <svg {...ICON_PROPS}>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
        <polyline points="9 14.5 11 16.5 15.5 12" />
      </svg>
    ),
  },
  {
    labelKey: "notif.reason.payslip",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <path d="M13.75 12.25h-2.5a1.25 1.25 0 0 0 0 2.5h1.5a1.25 1.25 0 0 1 0 2.5h-2.5" />
        <line x1="12" y1="11" x2="12" y2="18.5" />
      </svg>
    ),
  },
  {
    labelKey: "notif.reason.trainingPolicy",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22z" />
        <line x1="8" y1="7" x2="16" y2="7" />
        <line x1="8" y1="11" x2="13" y2="11" />
      </svg>
    ),
  },
  {
    labelKey: "notif.reason.announcements",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M3 11l18-5v12L3 13v-2z" />
        <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
      </svg>
    ),
  },
];

export default function NotificationsPromptPage() {
  const router = useRouter();
  const { user, loading: authLoading, staffCompletedStep } = useAuth();
  const { t, canChooseLanguage } = useLang();

  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);

  // Redirect edge cases from a useEffect (never call router.replace mid-
  // render — React throws in prod). AuthProvider is the primary gate; this
  // is just belt-and-braces for someone who navigates here manually.
  useEffect(() => {
    if (authLoading || !user) return;
    if (staffCompletedStep !== null && staffCompletedStep >= 7) {
      router.replace(ROUTES.staffHome);
    }
  }, [authLoading, user, staffCompletedStep, router]);

  async function handleEnable() {
    if (!user || busy) return;
    setBusy(true);
    setDenied(false);
    try {
      const token = await registerFcmToken(user.uid).catch((err) => {
        console.warn("[notifications-prompt] registerFcmToken failed:", err);
        return null;
      });
      // Record what happened either way so we don't nag on every visit.
      await setDoc(
        doc(getDb(), "staff_onboarding", user.uid),
        {
          notificationsPromptSeen: true,
          notificationsGranted: token !== null,
          notificationsPromptedAt: serverTimestamp(),
        },
        { merge: true },
      ).catch((err) => console.warn("[notifications-prompt] save failed:", err));
      // Judge this on the permission, not on the token. A granted permission
      // is the whole of what this screen asks for; the token can still come
      // back null because the VAPID key is missing or getToken lost a race
      // with the service worker, and none of that is something the employee
      // can act on. Blocking them on it stranded people who had already
      // tapped Allow behind a banner telling them to tap Allow. The token is
      // retried on every sign-in anyway.
      const granted =
        typeof window !== "undefined" &&
        "Notification" in window &&
        Notification.permission === "granted";

      if (token || granted) {
        router.replace(ROUTES.staffOnboarding);
      } else {
        // They denied the prompt, or the browser has no push support at all.
        // Keep them on this page — the copy tells them why.
        setDenied(true);
      }
    } finally {
      setBusy(false);
    }
  }

  if (authLoading || !user) return <Splash />;
  if (staffCompletedStep === null) return <Splash />;
  if (staffCompletedStep >= 7) return <Splash label="Redirecting…" />;

  return (
    <div className={styles.page}>
      {/* No second wordmark. The app bar directly above this already says
          YURICA, so "PROJECT YURICA" was branding the same screen twice — and it
          cost a line of height on the one screen that has to fit whole. */}
      <div className={styles.bellWrap} aria-hidden="true">
        <div className={styles.bellHalo}>
          <span className={styles.bell}>🔔</span>
          <span className={styles.bellCheck}>✓</span>
        </div>
      </div>

      <h1 className={styles.title}>{t("notif.title")}</h1>
      <p className={styles.subtitle}>{t("notif.subtitle")}</p>

      <ul className={styles.reasons}>
        {REASONS.map((reason) => (
          <li className={styles.reason} key={reason.labelKey}>
            <span className={styles.reasonIcon} aria-hidden="true">
              {reason.icon}
            </span>
            <span>{t(reason.labelKey)}</span>
          </li>
        ))}
      </ul>

      {/* Language toggle — the first-login placement asked for by the
          owner so Japanese staff can switch before starting onboarding.
          Gone once the owner activates them: at that point the provider
          pins the app to English, so a toggle here would be a control that
          does nothing. Reachable in that state because a rejected section
          sends an already-activated employee back through onboarding. */}
      {canChooseLanguage && (
        <div className={styles.langRow}>
          <LanguageToggle />
        </div>
      )}

      <p className={styles.trustLine}>
        <span aria-hidden="true">🛡️</span> {t("notif.trust")}
      </p>

      {denied && (
        <p className={styles.deniedBanner}>{t("notif.denied")}</p>
      )}

      <button
        type="button"
        className={styles.enableBtn}
        onClick={() => void handleEnable()}
        disabled={busy}
      >
        <span aria-hidden="true">🔔</span>{" "}
        {busy ? t("notif.enabling") : t("notif.enableBtn")}
      </button>
    </div>
  );
}
