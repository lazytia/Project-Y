"use client";

import { useEffect } from "react";
import { APP_READY_EVENT, AUTH_READY_EVENT } from "@/lib/app-ready";
import {
  clientShellPainted,
  hasPageLoadingMarker,
  hasSessionCookie,
  hideBootSplash,
  hideServerAppShell,
  isBootSplashVisible,
  ssrShellVisible,
} from "@/lib/boot-splash";

const FALLBACK_MS = 8_000;

export default function BootSplashDismiss() {
  useEffect(() => {
    let hidden = false;
    let appReady = false;
    let authReady = false;
    let raf = 0;

    const handoffFromSsr = () => {
      if (clientShellPainted()) hideServerAppShell();
      else raf = requestAnimationFrame(handoffFromSsr);
    };

    const hideOnce = () => {
      if (hidden) return;

      // Inline layout script already removed the splash for SSR sessions.
      if (!isBootSplashVisible()) {
        if (clientShellPainted()) {
          hidden = true;
          hideServerAppShell();
        } else {
          raf = requestAnimationFrame(hideOnce);
        }
        return;
      }

      const sessionKnown = authReady || hasSessionCookie();
      if (!appReady || !sessionKnown) {
        raf = requestAnimationFrame(hideOnce);
        return;
      }
      if (hasPageLoadingMarker() && !ssrShellVisible()) {
        raf = requestAnimationFrame(hideOnce);
        return;
      }

      const clientReady = clientShellPainted();
      const ssrReady = ssrShellVisible();
      if (!clientReady && !ssrReady) {
        raf = requestAnimationFrame(hideOnce);
        return;
      }

      hidden = true;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          hideBootSplash();
          document.getElementById("ssr-dash-preparing")?.remove();
          if (clientReady) hideServerAppShell();
          else handoffFromSsr();
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
