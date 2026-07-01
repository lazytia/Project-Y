"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, signOut as fbSignOut, type User } from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { useRouter, usePathname } from "next/navigation";
import { getAuth, getDb } from "@/lib/firebase";
import { PUBLIC_ROUTES, ROUTES, isStaffAllowedPath } from "@/lib/routes";
import { isOwner, isChef } from "@/lib/permissions";
import { emailToUsername } from "@/lib/username";

const TOTAL_ONBOARDING_STEPS = 7;

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
  /**
   * For non-owner users only: how many onboarding steps the staff has
   * completed (0–TOTAL_ONBOARDING_STEPS). `null` while still loading or
   * for owners/managers.
   */
  staffCompletedStep: number | null;
  /**
   * True if the signed-in user is a non-owner who has NOT yet completed
   * onboarding. Used by the shell to lock down nav.
   */
  staffNeedsOnboarding: boolean;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  signOut: async () => {},
  staffCompletedStep: null,
  staffNeedsOnboarding: false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [staffCompletedStep, setStaffCompletedStep] = useState<number | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const unsub = onAuthStateChanged(getAuth(), (u) => {
      setUser(u);
      setLoading(false);
      if (!u) setStaffCompletedStep(null);
    });
    return () => unsub();
  }, []);

  // On auth-state change: backfill role/username on the staff_onboarding doc
  // AND read back the user's completedStep so we know whether they still
  // owe us an onboarding flow.
  useEffect(() => {
    if (loading || !user) return;
    const username = emailToUsername(user.email ?? "").toLowerCase();
    const role = isOwner(user) ? "owner" : isChef(user) ? "chef" : "staff";
    const ref = doc(getDb(), "staff_onboarding", user.uid);

    // Fire-and-forget: don't block rendering on the write.
    setDoc(
      ref,
      {
        uid: user.uid,
        username,
        email: user.email ?? null,
        role,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ).catch(() => {/* best-effort */});

    // Only staff need to wait for completedStep — read it in parallel.
    // Chefs skip onboarding for now, so we short-circuit to "complete".
    if (!isOwner(user) && !isChef(user)) {
      getDoc(ref)
        .then((snap) => {
          const data = snap.data() ?? {};
          const completed = typeof data.completedStep === "number" ? data.completedStep : 0;
          setStaffCompletedStep(completed);
        })
        .catch(() => {
          setStaffCompletedStep(0);
        });
    } else if (isChef(user)) {
      setStaffCompletedStep(TOTAL_ONBOARDING_STEPS);
    }
  }, [user, loading]);

  const userIsOwner = isOwner(user);
  const userIsChef = isChef(user);
  const staffNeedsOnboarding =
    !!user &&
    !userIsOwner &&
    !userIsChef &&
    staffCompletedStep !== null &&
    staffCompletedStep < TOTAL_ONBOARDING_STEPS;

  useEffect(() => {
    if (loading) return;
    const isPublic = PUBLIC_ROUTES.has(pathname);
    if (!user && !isPublic) {
      router.replace(ROUTES.login);
      return;
    }

    // Wait until we know the staff's completedStep before routing them around
    // — otherwise we'd flash /staff before bouncing back to /onboarding.
    const userIsOwnerNow = isOwner(user);
    if (user && !userIsOwnerNow && staffCompletedStep === null) return;

    const inOnboarding = pathname.startsWith(ROUTES.staffOnboarding);

    if (user && isPublic) {
      // Just signed in. Staff who still owe us onboarding go straight to it,
      // everyone else goes to their Home / Dashboard.
      if (staffNeedsOnboarding) {
        router.replace(ROUTES.staffOnboarding);
      } else if (userIsOwnerNow) {
        router.replace(ROUTES.home);
      } else if (isChef(user)) {
        router.replace(ROUTES.chefHome);
      } else {
        router.replace(ROUTES.staffHome);
      }
      return;
    }

    // Staff who haven't finished onboarding are locked to /onboarding/*.
    if (user && staffNeedsOnboarding && !inOnboarding) {
      router.replace(ROUTES.staffOnboarding);
      return;
    }

    // Completed non-owner trying to visit an owner-only path → bounce to Home.
    if (user && !userIsOwnerNow && !isStaffAllowedPath(pathname)) {
      router.replace(isChef(user) ? ROUTES.chefHome : ROUTES.staffHome);
    }
  }, [user, loading, pathname, router, staffCompletedStep, staffNeedsOnboarding]);

  const signOut = async () => {
    await fbSignOut(getAuth());
    router.replace(ROUTES.login);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signOut,
        staffCompletedStep,
        staffNeedsOnboarding,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
