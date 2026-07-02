"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { PUBLIC_ROUTES } from "@/lib/routes";
import { isOwner, isChef } from "@/lib/permissions";

/**
 * Hides the static #boot-splash from layout once the app is ready to paint
 * real UI. Keeps the splash visible through auth restore so users never see
 * a blank/black screen between HTML parse and React hydration.
 *
 * Important: we DO NOT .remove() the node — React rendered it from
 * RootLayout, so ripping it out of the DOM leaves React's reconciler with a
 * stale fiber pointer. The next commit that touches a sibling then throws
 * "Failed to execute 'insertBefore' / 'removeChild'". Hiding via a class
 * keeps the node in place so React can continue managing it.
 */
function hideBootSplash() {
  const el = document.getElementById("boot-splash");
  if (el) el.classList.add("bootSplashHidden");
}

export default function BootSplashDismiss() {
  const { user, loading, staffCompletedStep } = useAuth();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;

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
