"use client";

import { useEffect } from "react";
import { APP_READY_EVENT, AUTH_READY_EVENT } from "@/lib/app-ready";
import { hasPageLoadingMarker, hideBootSplash } from "@/lib/boot-splash";

const FALLBACK_MS = 5_000;

function shellPainted(): boolean {
  const shell = document.querySelector("[data-app-shell='true']");
  const rect = shell?.getBoundingClientRect();
  if (rect && rect.width > 0) return true;
  const ssr = document.getElementById("server-app-shell");
  return !!ssr && !ssr.hasAttribute("hidden");
}

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
      if (!shellPainted()) {
        raf = requestAnimationFrame(hideOnce);
        return;
      }

      hidden = true;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          hideBootSplash();
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
