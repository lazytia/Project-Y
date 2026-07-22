"use client";

import type { User } from "firebase/auth";

/** Refresh the HTTP-only session cookie from the current Firebase user. */
export async function refreshAuthSession(user: User): Promise<boolean> {
  try {
    const idToken = await user.getIdToken(true);
    const res = await fetch("/api/auth/session", {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}` },
    });
    return res.ok;
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
