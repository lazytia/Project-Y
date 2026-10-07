"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

/**
 * Back as the screen *above* this one, named outright.
 *
 * The app's default is useBackToDashboard, and that file explains why Back is
 * a destination rather than `router.back()`. The reasoning is the same here —
 * history is where you came from, which on a phone is rarely the parent — but
 * the dashboard is only the right parent for a screen the dashboard owns.
 *
 * A document under Documents & Training does not qualify: it is opened from
 * that list, and someone who has just finished reading one wants the list back
 * so they can open the next. Sending them to the dashboard made the list a
 * one-shot — every document cost a trip through the menu to return to.
 *
 * So the destination is a parameter. Only the page knows what it sits under,
 * and saying so in one call is both the behaviour and the documentation.
 */
export function useBackTo(href: string): () => void {
  const router = useRouter();
  return useCallback(() => {
    router.push(href);
  }, [router, href]);
}
