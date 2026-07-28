"use client";

import { useEffect } from "react";
import { APP_READY_EVENT, AUTH_READY_EVENT } from "@/lib/app-ready";
import {
  clientShellPainted,
  hasPageLoadingMarker,
  hideBootSplash,
  hideServerAppShell,
  isBootSplashVisible,
  ssrShellVisible,
} from "@/lib/boot-splash";
import { hasClientSessionHint } from "@/lib/client-session-hint";

const FALLBACK_MS = 2_000;

export default function BootSplashDismiss() {
  useEffect(() => {
    let hidden = !isBootSplashVisible();
    let appReady = false;
    let authReady = false;
    let raf = 0;

    const handoffFromSsr = () => {
      if (clientShellPainted()) {
        hideServerAppShell();
        document.getElementById("static-chrome-fallback")?.setAttribute("hidden", "");
      } else {
        raf = requestAnimationFrame(handoffFromSsr);
      }
    };

    // Returning users: splash already hidden by inline/head scripts — hand off now.
    if (
      hidden ||
      document.documentElement.classList.contains("y-has-session") ||
      hasClientSessionHint()
    ) {
      hidden = true;
      hideBootSplash();
      handoffFromSsr();
    }

    const hideOnce = () => {
      const fallbackEl = document.getElementById("static-chrome-fallback");
      const fallbackVisible = !!fallbackEl && !fallbackEl.hasAttribute("hidden");
      const chromeVisible = ssrShellVisible() || fallbackVisible;

      if (hidden) {
        if (clientShellPainted()) {
          hideServerAppShell();
          fallbackEl?.setAttribute("hidden", "");
        } else if (chromeVisible) {
          handoffFromSsr();
        }
        return;
      }

      const sessionKnown = authReady || hasClientSessionHint();

      // Returning users: drop splash as soon as any chrome is visible — don't
      // wait for Firebase authStateReady or the full JS bundle.
      if (hasClientSessionHint() && chromeVisible) {
        hidden = true;
        hideBootSplash();
        if (clientShellPainted()) hideServerAppShell();
        else handoffFromSsr();
        return;
      }

      if (!appReady || !sessionKnown) {
        raf = requestAnimationFrame(hideOnce);
        return;
      }
      if (hasPageLoadingMarker() && !chromeVisible) {
        raf = requestAnimationFrame(hideOnce);
        return;
      }

      const clientReady = clientShellPainted();
      if (!clientReady && !chromeVisible) {
        raf = requestAnimationFrame(hideOnce);
        return;
      }

      hidden = true;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          hideBootSplash();
          document.getElementById("ssr-dash-preparing")?.remove();
          if (clientReady) {
            hideServerAppShell();
            fallbackEl?.setAttribute("hidden", "");
          } else {
            handoffFromSsr();
          }
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

    const fallbackTimer = window.setTimeout(() => {
      appReady = true;
      authReady = true;
      hideOnce();
    }, FALLBACK_MS);

    hideOnce();

    return () => {
      window.removeEventListener(APP_READY_EVENT, onAppReady);
      window.removeEventListener(AUTH_READY_EVENT, onAuthReady);
      window.clearTimeout(fallbackTimer);
      cancelAnimationFrame(raf);
    };
  }, []);

  return null;
}
