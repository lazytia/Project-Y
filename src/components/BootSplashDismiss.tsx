"use client";

import { useEffect } from "react";
import { APP_READY_EVENT, DASHBOARD_READY_EVENT } from "@/lib/app-ready";
import { hideBootSplashWhenSafe } from "@/lib/boot-splash";

const FALLBACK_MS = 8_000;

export default function BootSplashDismiss() {
  useEffect(() => {
    let hidden = false;
    let appReady = false;
    let dashboardReady = !document.getElementById("ssr-dash-preparing");

    const hideOnce = () => {
      if (hidden) return;
      if (!appReady || !dashboardReady) return;
      hidden = true;
      hideBootSplashWhenSafe();
      requestAnimationFrame(() => {
        document.getElementById("ssr-dash-preparing")?.remove();
      });
    };

    const onAppReady = () => {
      appReady = true;
      hideOnce();
    };
    const onDashboardReady = () => {
      dashboardReady = true;
      hideOnce();
    };

    window.addEventListener(APP_READY_EVENT, onAppReady);
    window.addEventListener(DASHBOARD_READY_EVENT, onDashboardReady);

    const fallback = window.setTimeout(() => {
      appReady = true;
      dashboardReady = true;
      hideOnce();
    }, FALLBACK_MS);

    return () => {
      window.removeEventListener(APP_READY_EVENT, onAppReady);
      window.removeEventListener(DASHBOARD_READY_EVENT, onDashboardReady);
      window.clearTimeout(fallback);
    };
  }, []);

  return null;
}
