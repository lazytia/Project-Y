"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { PUBLIC_ROUTES } from "@/lib/routes";
import { isOwner, isChef } from "@/lib/permissions";
import { fetchSessionHint } from "@/lib/auth-session-client";

/**
 * Hides the static #boot-splash from layout once the app is ready to paint
 * real UI. Keeps the splash visible through auth restore so users never see
 * a blank/black screen between HTML parse and React hydration.
 */
function hideBootSplash() {
  const el = document.getElementById("boot-splash");
  if (el) el.classList.add("bootSplashHidden");
}

export default function BootSplashDismiss() {
  const { user, loading, staffCompletedStep } = useAuth();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) {
      if (PUBLIC_ROUTES.has(pathname)) return;
      let cancelled = false;
      void fetchSessionHint().then((hint) => {
        if (cancelled || !hint.authenticated) return;
        hideBootSplash();
      });
      return () => { cancelled = true; };
    }

    const isPublic = PUBLIC_ROUTES.has(pathname);
    if (isPublic) {
      hideBootSplash();
      return;
    }

    if (!user) {
      hideBootSplash();
      return;
    }

    if (isOwner(user) || isChef(user) || staffCompletedStep !== null) {
      hideBootSplash();
    }
  }, [user, loading, pathname, staffCompletedStep]);

  return null;
}
