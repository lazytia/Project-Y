"use client";

import type { User } from "firebase/auth";
import { dashboardKindFromEmail } from "@/lib/session-dashboard";
import { setClientDashboardHint } from "@/lib/client-session-hint";

/**
 * Which generation of the session the app is on. Bumped by every teardown.
 *
 * Minting a session is not instant: `refreshAuthSession` first does
 * `getIdToken(true)`, a network round trip to Google, and only then POSTs —
 * and the POST sets `uid`, `role`, `dash` and `y_sess` unconditionally on the
 * way back. It is fired from four places (AuthProvider's auth-state listener,
 * the login handoff, and AuthSessionKeeper's listener plus its
 * visibility/pageshow/interval syncs), so at any moment one of them may be in
 * the air. If the user taps Sign out during that window, the POST lands after
 * the DELETE and quietly resurrects the whole session.
 *
 * That is not a cosmetic race. The app shell trusts the client-readable
 * `y_sess` cookie over Firebase, so a single late POST leaves a signed-out
 * user looking at signed-in chrome: the press reads as ignored, and the next
 * one strands them on a splash waiting for a session that is never coming.
 *
 * A counter rather than a boolean, because "signing out" has no end event to
 * clear — the next sign-in simply starts a later generation.
 */
let sessionEpoch = 0;

/**
 * Void every session write already in flight. Call before revoking Firebase,
 * so the window between the tap and the DELETE is covered too.
 */
export function beginAuthSessionTeardown(): void {
  sessionEpoch += 1;
}

/** Refresh the HTTP-only session cookie from the current Firebase user. */
export async function refreshAuthSession(user: User): Promise<boolean> {
  const epoch = sessionEpoch;
  try {
    const idToken = await user.getIdToken(true);
    // Cheap exit: a sign-out that started while we were fetching the token
    // means there is nothing left worth minting.
    if (epoch !== sessionEpoch) return false;
    const res = await fetch("/api/auth/session", {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) return false;
    if (epoch !== sessionEpoch) {
      // Too late to skip the POST — the cookies are already in the browser,
      // and they belong to a session the user has since left. Take them back
      // out rather than leaving a resurrected `y_sess` behind.
      //
      // Note this deletes without bumping the epoch. Going through
      // clearAuthSession() here would advance the generation as a side effect
      // of cleaning up an old one, and a sign-in that had already captured the
      // current epoch would then mistake itself for stale and undo its own
      // cookies. Only a real teardown gets to move the counter.
      await deleteSessionCookies();
      return false;
    }
    const data = (await res.json()) as { dashboard?: string };
    const dash = data.dashboard ?? dashboardKindFromEmail(user.email);
    setClientDashboardHint(dash);
    return true;
  } catch {
    return false;
  }
}

async function deleteSessionCookies(): Promise<void> {
  try {
    await fetch("/api/auth/session", { method: "DELETE" });
  } catch {
    /* ignore */
  }
}

export async function clearAuthSession(): Promise<void> {
  beginAuthSessionTeardown();
  await deleteSessionCookies();
}

export type SessionHint = {
  authenticated: boolean;
  uid?: string;
  role?: string;
};

export async function fetchSessionHint(): Promise<SessionHint> {
  try {
    const res = await fetch("/api/auth/session", { cache: "no-store" });
    if (!res.ok) return { authenticated: false };
    return (await res.json()) as SessionHint;
  } catch {
    return { authenticated: false };
  }
}
