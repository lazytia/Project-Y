"use client";

import { useEffect } from "react";
import { APP_READY_EVENT } from "@/lib/app-ready";
import { hideBootSplashWhenSafe } from "@/lib/boot-splash";

const FALLBACK_MS = 15_000;

/**
 * Hides the inline boot splash once the client shell mounts — like
 * system-yurica, we don't wait for Firebase auth before showing chrome.
 */
export default function BootSplashDismiss() {
  useEffect(() => {
    let hidden = false;
    const hideOnce = () => {
      if (hidden) return;
      hidden = true;
      hideBootSplashWhenSafe();
    };

    const onShellReady = () => hideOnce();
    window.addEventListener(APP_READY_EVENT, onShellReady);
    const fallback = window.setTimeout(hideOnce, FALLBACK_MS);

    return () => {
      window.removeEventListener(APP_READY_EVENT, onShellReady);
      window.clearTimeout(fallback);
    };
  }, []);

  return null;
}
