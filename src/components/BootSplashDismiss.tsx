"use client";

import { useEffect } from "react";
import { useAuth } from "./AuthProvider";
import { APP_READY_EVENT, isAppReady } from "@/lib/app-ready";
import { hideBootSplashWhenSafe } from "@/lib/boot-splash";

const FALLBACK_MS = 15_000;

/**
 * Keeps the inline HTML boot splash until Firebase auth finishes restoring
 * AND the styled client shell has mounted. Hiding on first React commit left
 * a multi-second white gap while CSS modules were still downloading.
 */
export default function BootSplashDismiss() {
  const { loading } = useAuth();

  useEffect(() => {
    if (loading) return;

    let hidden = false;
    const hideOnce = () => {
      if (hidden) return;
      hidden = true;
      hideBootSplashWhenSafe();
    };

    if (isAppReady()) {
      hideOnce();
      return;
    }

    const onShellReady = () => hideOnce();
    window.addEventListener(APP_READY_EVENT, onShellReady);
    const fallback = window.setTimeout(hideOnce, FALLBACK_MS);

    return () => {
      window.removeEventListener(APP_READY_EVENT, onShellReady);
      window.clearTimeout(fallback);
    };
  }, [loading]);

  return null;
}
