"use client";

import { useEffect } from "react";
import { APP_READY_EVENT, AUTH_READY_EVENT } from "@/lib/app-ready";
import {
  clientShellPainted,
  hasPageLoadingMarker,
  hideBootSplash,
  hideServerAppShell,
} from "@/lib/boot-splash";

const FALLBACK_MS = 8_000;

export default function BootSplashDismiss() {
  useEffect(() => {
    let hidden = false;
    let appReady = false;
    let authReady = false;
    let raf = 0;

    const hideOnce = () => {
      if (hidden) return;

      if (!appReady || !authReady) {
        raf = requestAnimationFrame(hideOnce);
        return;
      }
      if (hasPageLoadingMarker()) {
        raf = requestAnimationFrame(hideOnce);
        return;
      }
      // Wait for the client React shell — not SSR chrome alone. Dismissing
      // on #server-app-shell caused a ~2s blank gap before hydration.
      if (!clientShellPainted()) {
        raf = requestAnimationFrame(hideOnce);
        return;
      }

      hidden = true;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          hideBootSplash();
          hideServerAppShell();
          document.getElementById("ssr-dash-preparing")?.remove();
        });
      });
    };

    const onAppReady = () => {
      appReady = true;
      hideOnce();
    };
    const onAuthReady = () => {
      authReady = true;
      hideOnce();
    };

    window.addEventListener(APP_READY_EVENT, onAppReady);
    window.addEventListener(AUTH_READY_EVENT, onAuthReady);

    const fallback = window.setTimeout(() => {
      appReady = true;
      authReady = true;
      hideOnce();
    }, FALLBACK_MS);

    hideOnce();

    return () => {
      window.removeEventListener(APP_READY_EVENT, onAppReady);
      window.removeEventListener(AUTH_READY_EVENT, onAuthReady);
      window.clearTimeout(fallback);
      cancelAnimationFrame(raf);
    };
  }, []);

  return null;
}
