"use client";

import { useEffect } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { getAuth } from "@/lib/firebase";
import { refreshAuthSession } from "@/lib/auth-session-client";

const SESSION_REFRESH_MS = 50 * 60 * 1000;

/**
 * Keeps the server `uid` session cookie in sync with Firebase auth so PWA
 * restarts can paint the app shell before the client SDK finishes restoring.
 */
export default function AuthSessionKeeper() {
  useEffect(() => {
    const auth = getAuth();

    const syncSession = async () => {
      const user = auth.currentUser;
      if (!user) return;
      await refreshAuthSession(user);
    };

    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) void refreshAuthSession(user);
    });

    const interval = window.setInterval(() => void syncSession(), SESSION_REFRESH_MS);

    const onVis = () => {
      if (document.visibilityState === "visible") void syncSession();
    };
    const onPageShow = () => void syncSession();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      unsub();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  return null;
}
