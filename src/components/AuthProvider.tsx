"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, signOut as fbSignOut, type User } from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { useRouter, usePathname } from "next/navigation";
import { getAuth, getDb } from "@/lib/firebase";
import { PUBLIC_ROUTES, ROUTES, isStaffAllowedPath } from "@/lib/routes";
import { isOwner } from "@/lib/permissions";
import { emailToUsername } from "@/lib/username";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const unsub = onAuthStateChanged(getAuth(), (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // One-shot backfill on auth state change: make sure every staff_onboarding
  // doc has a `role` marker and a human-readable identifier (username/email).
  // Owners get role:"owner" so they're filtered out of the staff list; staff
  // accounts created before we started persisting username get patched too.
  useEffect(() => {
    if (loading || !user) return;
    const username = emailToUsername(user.email ?? "").toLowerCase();
    const role = isOwner(user) ? "owner" : "staff";
    setDoc(
      doc(getDb(), "staff_onboarding", user.uid),
      {
        uid: user.uid,
        username,
        email: user.email ?? null,
        role,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ).catch(() => { /* best-effort backfill */ });
  }, [user, loading]);

  useEffect(() => {
    if (loading) return;
    const isPublic = PUBLIC_ROUTES.has(pathname);
    if (!user && !isPublic) {
      router.replace(ROUTES.login);
      return;
    }
    if (user && isPublic) {
      // Just signed in — owners + managers go to the dashboard, staff to
      // their staff Home page. Onboarding is reachable from the sidebar
      // for staff who still need to finish it.
      router.replace(isOwner(user) ? ROUTES.home : ROUTES.staffHome);
      return;
    }
    // Non-owner trying to visit an owner-only path → bounce to staff Home.
    if (user && !isOwner(user) && !isStaffAllowedPath(pathname)) {
      router.replace(ROUTES.staffHome);
    }
  }, [user, loading, pathname, router]);

  const signOut = async () => {
    await fbSignOut(getAuth());
    router.replace(ROUTES.login);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
