"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { getAuth } from "@/lib/firebase";
import { usernameToEmail } from "@/lib/username";
import { ROUTES } from "@/lib/routes";
import { isOwner } from "@/lib/permissions";
import { registerFcmToken } from "@/lib/fcm";
import styles from "./page.module.css";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

      // Best-effort: store the FCM token now that we have the uid. This is
      // silent — only succeeds if the user granted permission above.
      if (notifPermission === "granted") {
        registerFcmToken(cred.user.uid).catch(() => { /* silent */ });
      }

      // Owners land on the dashboard; staff land on their onboarding overview.
      const dest = isOwner(cred.user) ? ROUTES.home : ROUTES.staffOnboarding;
      router.push(dest);
    } catch {
      setError("Invalid username or password");
      setBusy(false);
    }
  };

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
