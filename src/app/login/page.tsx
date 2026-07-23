"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { getAuth } from "@/lib/firebase";
import { usernameToEmail } from "@/lib/username";
import { ROUTES } from "@/lib/routes";
import { isOwner } from "@/lib/permissions";
import { registerFcmToken } from "@/lib/fcm";
import { refreshAuthSession } from "@/lib/auth-session-client";
import { useAuth } from "@/components/AuthProvider";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

export default function LoginPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Cookie-hint check runs after mount (never in initial state — that
  // would diverge between SSR and client render). If the browser has a
  // recent session cookie, Firebase Auth almost certainly will resolve
  // to a real user in a moment — keep the splash up instead of
  // flashing the login form.
  const [hasSessionCookieGuess, setHasSessionCookieGuess] = useState(false);
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.cookie.includes("uid=")) setHasSessionCookieGuess(true);
  }, []);

  // Owner reported the login form was flashing for a split second on
  // cold app launch before AuthProvider resolved and redirected to
  // Home. Hold the splash while Firebase Auth is still hydrating OR
  // while a signed-in user is present (in that case AppShell's
  // useEffect is about to push us off /login anyway).
  const shouldHoldSplash =
    authLoading || !!user || (hasSessionCookieGuess && !authLoading && !user);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // iOS only shows the notification permission prompt when
    // Notification.requestPermission() is called INSIDE a user gesture
    // (transient activation, ~5s window after the click). We trigger it
    // BEFORE the network signIn so the gesture context is fresh, then
    // register the FCM token once we know the uid.
    let notifPermission: NotificationPermission | "unsupported" = "unsupported";
    if (typeof window !== "undefined" && "Notification" in window) {
      notifPermission = Notification.permission;
      if (notifPermission === "default") {
        try {
          notifPermission = await Notification.requestPermission();
        } catch {
          /* ignore — proceed with sign-in regardless */
        }
      }
    }

    setBusy(true);
    try {
      const cred = await signInWithEmailAndPassword(
        getAuth(),
        usernameToEmail(username),
        password,
      );

      // Staff MUST have notifications enabled — they're the channel managers
      // use to remind staff about pending onboarding work. If a non-owner
      // didn't grant permission, sign them straight back out and show
      // actionable guidance for each failure mode.
      if (!isOwner(cred.user) && notifPermission !== "granted") {
        await signOut(getAuth()).catch(() => {});
        if (notifPermission === "denied") {
          setError(
            "Notifications are blocked. Open iPhone Settings → Notifications → Project Y, turn on \"Allow Notifications\", then sign in again.",
          );
        } else if (notifPermission === "unsupported") {
          setError(
            "This device can't receive notifications. Install the Project Y app on your iPhone or Android, open it from the home screen, and sign in there.",
          );
        } else {
          setError(
            "Please allow notifications when prompted, then sign in again.",
          );
        }
        setBusy(false);
        return;
      }

      // Best-effort: store the FCM token now that we have the uid.
      if (notifPermission === "granted") {
        registerFcmToken(cred.user.uid).catch(() => { /* silent */ });
      }

      await refreshAuthSession(cred.user);

      // Owners + managers land on the dashboard; staff land on their staff
      // Home page (onboarding is still reachable from their sidebar).
      const dest = isOwner(cred.user) ? ROUTES.home : ROUTES.staffHome;
      router.push(dest);
    } catch {
      setError("Invalid username or password");
      setBusy(false);
    }
  };

  if (shouldHoldSplash) {
    return <Splash />;
  }

  return (
    <div className={styles.card}>
      <h1 className={styles.title}>Project Y</h1>
      <p className={styles.subtitle}>Sign in to continue</p>

      <form className={styles.form} onSubmit={handleSubmit}>
        <label className={styles.field}>
          <span>Username</span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
          />
        </label>
        <label className={styles.field}>
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </label>

        {error && <div className={styles.error}>{error}</div>}

        <button type="submit" className={styles.submit} disabled={busy}>
          {busy ? "…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
