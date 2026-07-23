"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  APP_READY_EVENT,
  AUTH_READY_EVENT,
  DASHBOARD_READY_EVENT,
} from "@/lib/app-ready";
import { hasPageLoadingMarker, hideBootSplash } from "@/lib/boot-splash";

const FALLBACK_MS = 8_000;
const DASHBOARD_ROUTES = new Set(["/", "/chef"]);

export default function BootSplashDismiss() {
  const pathname = usePathname();

  useEffect(() => {
    let hidden = false;
    let appReady = false;
    let authReady = false;
    let dashboardReady = false;
    let raf = 0;

    const dashboardRoute = DASHBOARD_ROUTES.has(pathname);

    const hideOnce = () => {
      if (hidden) return;

      if (!appReady || !authReady) {
        raf = requestAnimationFrame(hideOnce);
        return;
      }
      if (dashboardRoute && !dashboardReady) {
        raf = requestAnimationFrame(hideOnce);
        return;
      }
      if (hasPageLoadingMarker()) {
        raf = requestAnimationFrame(hideOnce);
        return;
      }

      const shell = document.querySelector("[data-app-shell='true']");
      const rect = shell?.getBoundingClientRect();
      if (!rect || rect.width === 0) {
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

    hideOnce();

    return () => {
      window.removeEventListener(APP_READY_EVENT, onAppReady);
      window.removeEventListener(AUTH_READY_EVENT, onAuthReady);
      window.removeEventListener(DASHBOARD_READY_EVENT, onDashboardReady);
      window.clearTimeout(fallback);
      cancelAnimationFrame(raf);
    };
  }, [pathname]);

  return null;
}
