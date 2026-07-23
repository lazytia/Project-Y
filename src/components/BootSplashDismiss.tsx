"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  APP_READY_EVENT,
  AUTH_READY_EVENT,
  DASHBOARD_READY_EVENT,
} from "@/lib/app-ready";
import { hideBootSplash } from "@/lib/boot-splash";

const FALLBACK_MS = 8_000;
const DASHBOARD_ROUTES = new Set(["/", "/chef"]);

export default function BootSplashDismiss() {
  const pathname = usePathname();

  useEffect(() => {
    let hidden = false;
    let appReady = false;
    let authReady = false;
    let dashboardReady = false;

    const dashboardRoute = DASHBOARD_ROUTES.has(pathname);

    const hideOnce = () => {
      if (hidden) return;
      if (!appReady) return;
      if (dashboardRoute && !authReady) return;
      if (dashboardRoute && !dashboardReady) return;
      hidden = true;
      requestAnimationFrame(() => {
        hideBootSplash();
        document.getElementById("ssr-dash-preparing")?.remove();
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
    const onDashboardReady = () => {
      dashboardReady = true;
      hideOnce();
    };

    window.addEventListener(APP_READY_EVENT, onAppReady);
    window.addEventListener(AUTH_READY_EVENT, onAuthReady);
    window.addEventListener(DASHBOARD_READY_EVENT, onDashboardReady);

    const fallback = window.setTimeout(() => {
      appReady = true;
      authReady = true;
      dashboardReady = true;
      hideOnce();
    }, FALLBACK_MS);

    return () => {
      window.removeEventListener(APP_READY_EVENT, onAppReady);
      window.removeEventListener(AUTH_READY_EVENT, onAuthReady);
      window.removeEventListener(DASHBOARD_READY_EVENT, onDashboardReady);
      window.clearTimeout(fallback);
    };
  }, [pathname]);

  return null;
}
