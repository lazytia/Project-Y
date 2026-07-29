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

    // CSS may hide the splash before JS runs — still remove the node for iOS.
    if (document.documentElement.classList.contains("y-has-session")) {
      hideBootSplash();
      hidden = true;
    }

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

    // Returning users with SSR chrome: splash already hidden by inline scripts.
    if (hidden || (document.documentElement.classList.contains("y-has-session") && ssrShellVisible())) {
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

      const isBareLogin =
        typeof window !== "undefined" &&
        window.location.pathname === "/login" &&
        !document.documentElement.classList.contains("y-has-session");

      const sessionKnown = authReady;

      if (isBareLogin && appReady) {
        hidden = true;
        hideBootSplash();
        return;
      }

      if (hasClientSessionHint() && chromeVisible && clientShellPainted()) {
        hidden = true;
        hideBootSplash();
        hideServerAppShell();
        fallbackEl?.setAttribute("hidden", "");
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
          document.getElementById("ssr-dash-preparing")?.setAttribute("hidden", "");
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
