"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, signOut as fbSignOut, type User } from "firebase/auth";
import { useRouter, usePathname } from "next/navigation";
import { getAuth } from "@/lib/firebase";
import { PUBLIC_ROUTES, ROUTES, isStaffAllowedPath } from "@/lib/routes";
import { isOwner } from "@/lib/permissions";

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

  useEffect(() => {
    if (loading) return;
    const isPublic = PUBLIC_ROUTES.has(pathname);
    if (!user && !isPublic) {
      router.replace(ROUTES.login);
      return;
    }
    if (user && isPublic) {
      // Just signed in — owners go to dashboard, staff to their onboarding.
      router.replace(isOwner(user) ? ROUTES.home : ROUTES.staffOnboarding);
      return;
    }
    // Non-owner trying to visit an owner-only path → bounce to onboarding.
    if (user && !isOwner(user) && !isStaffAllowedPath(pathname)) {
      router.replace(ROUTES.staffOnboarding);
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
