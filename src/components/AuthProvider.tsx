"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, signOut as fbSignOut, type User } from "firebase/auth";
import { doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { useRouter, usePathname } from "next/navigation";
import { getAuth, getDb } from "@/lib/firebase";
import { PUBLIC_ROUTES, ROUTES, isStaffAllowedPath } from "@/lib/routes";
import { isOwner, isChef } from "@/lib/permissions";
import { emailToUsername } from "@/lib/username";

const TOTAL_ONBOARDING_STEPS = 7;
const STAFF_STEP_CACHE_KEY = "y.staffStep";

type StaffStepCache = { uid: string; step: number };

function readStaffStepCache(uid: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STAFF_STEP_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StaffStepCache;
    if (parsed.uid !== uid || typeof parsed.step !== "number") return null;
    return parsed.step;
  } catch {
    return null;
  }
}

function writeStaffStepCache(uid: string, step: number) {
  try {
    sessionStorage.setItem(STAFF_STEP_CACHE_KEY, JSON.stringify({ uid, step }));
  } catch {
    /* ignore quota / private mode */
  }
}

function clearStaffStepCache() {
  try {
    sessionStorage.removeItem(STAFF_STEP_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

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
  // `null` while we haven't looked yet, `true` once the staff member has
  // seen (and accepted) the enable-notifications prompt, `false` if they
  // still owe us that step. Owners and chefs skip this entirely.
  const [notificationsPromptSeen, setNotificationsPromptSeen] = useState<boolean | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const unsub = onAuthStateChanged(getAuth(), (u) => {
      setUser(u);
      setLoading(false);
      if (!u) {
        setStaffCompletedStep(null);
        clearStaffStepCache();
        return;
      }
      if (isOwner(u)) {
        setStaffCompletedStep(null);
      } else if (isChef(u)) {
        setStaffCompletedStep(TOTAL_ONBOARDING_STEPS);
      } else {
        const cached = readStaffStepCache(u.uid);
        if (cached !== null) setStaffCompletedStep(cached);
      }
    });
    return () => unsub();
  }, []);

  // On auth-state change: backfill role/username on the staff_onboarding doc
  // AND subscribe to it so completedStep + notificationsPromptSeen stay in
  // sync with Firestore. A one-shot getDoc left the local state stale after
  // the notifications-prompt page flipped `notificationsPromptSeen` to true,
  // which caused the routing effect below to bounce the user between
  // /onboarding and /onboarding/notifications forever.
  useEffect(() => {
    if (loading || !user) return;
    const username = emailToUsername(user.email ?? "").toLowerCase();
    const role = isOwner(user) ? "owner" : isChef(user) ? "chef" : "staff";
    const ref = doc(getDb(), "staff_onboarding", user.uid);

    // Fire-and-forget: don't block rendering on the write.
    // Chefs are marked onboarding-complete for now — they don't have a
    // staff-style onboarding flow, and this keeps the Firestore doc
    // consistent with the AttentionRequired / dashboard queries.
    const chefOverride = isChef(user)
      ? { completedStep: TOTAL_ONBOARDING_STEPS, status: "complete" as const }
      : {};
    setDoc(
      ref,
      {
        uid: user.uid,
        username,
        email: user.email ?? null,
        role,
        ...chefOverride,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ).catch(() => {/* best-effort */});

    // Owners don't have an onboarding gate; chefs are short-circuited.
    if (isOwner(user)) return;
    if (isChef(user)) {
      setStaffCompletedStep(TOTAL_ONBOARDING_STEPS);
      setNotificationsPromptSeen(true);
      return;
    }

    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.data() ?? {};
        const completed = typeof data.completedStep === "number" ? data.completedStep : 0;
        writeStaffStepCache(user.uid, completed);
        setStaffCompletedStep(completed);
        setNotificationsPromptSeen(data.notificationsPromptSeen === true);
      },
      () => {
        const fallback = readStaffStepCache(user.uid) ?? 0;
        setStaffCompletedStep(fallback);
        // Fail-open on the notification gate — better to skip the
        // prompt than to trap the user on it.
        setNotificationsPromptSeen(true);
      },
    );
    return () => unsub();
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
    const userIsChefNow = isChef(user);
    if (user && !userIsOwnerNow && !userIsChefNow && staffCompletedStep === null) return;

    const inOnboarding = pathname.startsWith(ROUTES.staffOnboarding);
    // Staff mid-onboarding still need access to /staff/settings so they
    // can toggle EN/JA while filling out the forms — treat it as an
    // allowed escape hatch alongside the onboarding routes themselves.
    const inSettings = pathname === "/staff/settings";

    if (user && isPublic) {
      // Just signed in. Staff who still owe us onboarding go straight to it,
      // everyone else goes to their Home / Dashboard.
      if (staffNeedsOnboarding) {
        if (notificationsPromptSeen === false) {
          router.replace(ROUTES.staffNotificationsPrompt);
        } else {
          router.replace(ROUTES.staffOnboarding);
        }
      } else if (userIsOwnerNow) {
        router.replace(ROUTES.home);
      } else if (isChef(user)) {
        router.replace(ROUTES.chefHome);
      } else {
        router.replace(ROUTES.staffHome);
      }
      return;
    }

    // Staff who haven't finished onboarding are locked to /onboarding/*
    // (plus /staff/settings so they can flip the language toggle).
    if (user && staffNeedsOnboarding && !inOnboarding && !inSettings) {
      // New staff who haven't accepted the notifications prompt yet get
      // sent to that gate first, not straight into the onboarding form.
      if (notificationsPromptSeen === false) {
        router.replace(ROUTES.staffNotificationsPrompt);
      } else {
        router.replace(ROUTES.staffOnboarding);
      }
      return;
    }

    // Even inside /onboarding/*, if a staff member still owes us the
    // notifications gate and is trying to visit another onboarding step,
    // send them back to the prompt.
    if (
      user &&
      staffNeedsOnboarding &&
      notificationsPromptSeen === false &&
      inOnboarding &&
      pathname !== ROUTES.staffNotificationsPrompt
    ) {
      router.replace(ROUTES.staffNotificationsPrompt);
      return;
    }

    // Chefs skip onboarding entirely — bounce them out if they land there.
    if (user && isChef(user) && inOnboarding) {
      router.replace(ROUTES.chefHome);
      return;
    }

    // Completed non-owner trying to visit an owner-only path → bounce to Home.
    // Chefs have manager-level access so they are exempt from this restriction.
    if (user && !userIsOwnerNow && !userIsChefNow && !isStaffAllowedPath(pathname)) {
      router.replace(ROUTES.staffHome);
    }
  }, [user, loading, pathname, router, staffCompletedStep, staffNeedsOnboarding, notificationsPromptSeen]);

  const signOut = async () => {
    clearStaffStepCache();
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
