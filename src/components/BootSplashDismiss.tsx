"use client";

import { useEffect } from "react";
import { APP_READY_EVENT, AUTH_READY_EVENT, isAppReady } from "@/lib/app-ready";
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

    // Seeded, not waited for. APP_READY_EVENT is dispatched from
    // AppReadyMarker's useLayoutEffect, and React runs every layout effect in a
    // commit before any passive one — so by the time this effect subscribes the
    // event has already been and gone, and markAppReady() latches, so it never
    // comes again. The listener below caught nothing, and the only thing left
    // taking the splash down was the 2s fallback: measured at 2043ms on a
    // signed-out launch, every launch.
    let appReady = isAppReady();
    let authReady = false;
    let raf = 0;
    let fallbackTimer = 0;

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

    const armFallback = () => {
      window.clearTimeout(fallbackTimer);
      fallbackTimer = window.setTimeout(() => {
        appReady = true;
        authReady = true;
        hideOnce();
      }, FALLBACK_MS);
    };

    /**
     * Start the whole thing again on the way back to the foreground.
     *
     * Every route out of here is either a requestAnimationFrame chain or a
     * setTimeout, and a backgrounded app gets neither: rAF stops at the frame
     * the app was hidden on, and iOS suspends — then, past a minute or so of
     * another app, drops — pending timers outright. So an app put down during
     * its first two seconds comes back to a splash with nothing running that
     * could take it down. It is `position: fixed; inset: 0` over everything, so
     * that is the app open, on a white screen, ignoring every tap.
     *
     * Re-arming rather than forcing: the conditions in hideOnce() are still the
     * right ones, they just need something to ask them again.
     */
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      cancelAnimationFrame(raf);
      if (!hidden) armFallback();
      hideOnce();
    };

    window.addEventListener(APP_READY_EVENT, onAppReady);
    window.addEventListener(AUTH_READY_EVENT, onAuthReady);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);

    armFallback();
    hideOnce();

    return () => {
      window.removeEventListener(APP_READY_EVENT, onAppReady);
      window.removeEventListener(AUTH_READY_EVENT, onAuthReady);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
      window.clearTimeout(fallbackTimer);
      cancelAnimationFrame(raf);
    };
  }, []);

  return null;
}
