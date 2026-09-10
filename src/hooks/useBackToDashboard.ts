"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { dashboardRoute } from "@/lib/routes";

/**
 * What every Back control in the app does: go to this user's dashboard.
 *
 * It used to be `router.back()`, which sounds like the same thing and is not.
 * History is where you came *from*, and on a phone that is rarely the screen
 * above: a notification opens a page cold, so Back had nowhere to go; a chain
 * of taps through People → an employee → their documents left Back walking
 * the chain in reverse a screen at a time; and after a redirect it could
 * bounce straight back into the page you had just left. The dashboard is the
 * one destination that is always there and always meant something.
 *
 * Which dashboard depends on who is looking — `dashboardRoute` holds that
 * rule, shared with the post-login landing so the two cannot drift.
 */
export function useBackToDashboard(): () => void {
  const router = useRouter();
  const { user } = useAuth();
  return useCallback(() => {
    router.push(dashboardRoute(user));
  }, [router, user]);
}
