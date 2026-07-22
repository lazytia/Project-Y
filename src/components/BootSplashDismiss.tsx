"use client";

import { useEffect } from "react";
import { APP_READY_EVENT } from "@/lib/app-ready";
import { hideBootSplash, hideBootSplashWhenSafe } from "@/lib/boot-splash";

const FALLBACK_MS = 6_000;

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

    if (
      document.getElementById("ssr-dash-preparing") ||
      document.getElementById("server-app-shell")
    ) {
      hideBootSplash();
    }

    const fallback = window.setTimeout(hideOnce, FALLBACK_MS);

    return () => {
      window.removeEventListener(APP_READY_EVENT, onShellReady);
      window.clearTimeout(fallback);
    };
  }, []);

  return null;
}
