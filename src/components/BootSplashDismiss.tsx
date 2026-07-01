"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { PUBLIC_ROUTES } from "@/lib/routes";
import { isOwner, isChef } from "@/lib/permissions";

/**
 * Removes the static #boot-splash from layout once the app is ready to paint
 * real UI. Keeps the splash visible through auth restore so users never see
 * a blank/black screen between HTML parse and React hydration.
 */
export default function BootSplashDismiss() {
  const { user, loading, staffCompletedStep } = useAuth();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;

    const isPublic = PUBLIC_ROUTES.has(pathname);
    if (isPublic) {
      document.getElementById("boot-splash")?.remove();
      return;
    }

    if (!user) {
      document.getElementById("boot-splash")?.remove();
      return;
    }

    if (isOwner(user) || isChef(user) || staffCompletedStep !== null) {
      document.getElementById("boot-splash")?.remove();
    }
  }, [user, loading, pathname, staffCompletedStep]);

  return null;
}
