"use client";

import { useState } from "react";
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

type LoginClientProps = {
  /** From server uid cookie — avoids login-form flash while Auth hydrates. */
  initialHasSession: boolean;
};

export default function LoginClient({ initialHasSession }: LoginClientProps) {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const shouldHoldSplash =
    authLoading || !!user || (initialHasSession && !authLoading && !user);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    let notifPermission: NotificationPermission | "unsupported" = "unsupported";
    if (typeof window !== "undefined" && "Notification" in window) {
      notifPermission = Notification.permission;
      if (notifPermission === "default") {
        try {
          notifPermission = await Notification.requestPermission();
        } catch {
          /* ignore */
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

      if (notifPermission === "granted") {
        registerFcmToken(cred.user.uid).catch(() => {});
      }

      await refreshAuthSession(cred.user);

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
