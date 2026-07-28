"use client";

import type { User } from "firebase/auth";
import { dashboardKindFromEmail } from "@/lib/session-dashboard";
import { setClientDashboardHint } from "@/lib/client-session-hint";

/** Refresh the HTTP-only session cookie from the current Firebase user. */
export async function refreshAuthSession(user: User): Promise<boolean> {
  try {
    const idToken = await user.getIdToken(true);
    const res = await fetch("/api/auth/session", {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { dashboard?: string };
    const dash = data.dashboard ?? dashboardKindFromEmail(user.email);
    setClientDashboardHint(dash);
    return true;
  } catch {
    return false;
  }
}

export async function clearAuthSession(): Promise<void> {
  try {
    await fetch("/api/auth/session", { method: "DELETE" });
  } catch {
    /* ignore */
  }
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
