"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { PUBLIC_ROUTES } from "@/lib/routes";
import { isOwner, isChef } from "@/lib/permissions";
import { fetchSessionHint } from "@/lib/auth-session-client";

function hideBootSplash() {
  const el = document.getElementById("boot-splash");
  if (el) el.classList.add("bootSplashHidden");
}

export default function BootSplashDismiss({
  initialHasSession = false,
}: {
  initialHasSession?: boolean;
}) {
  const { user, loading, staffCompletedStep } = useAuth();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) {
      if (PUBLIC_ROUTES.has(pathname)) return;
      if (initialHasSession) {
        hideBootSplash();
        return;
      }
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
  }, [user, loading, pathname, staffCompletedStep, initialHasSession]);

  return null;
}
