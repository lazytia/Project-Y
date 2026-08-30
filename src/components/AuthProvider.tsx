"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { useRouter, usePathname } from "next/navigation";
import { beginAuthSessionTeardown, clearAuthSession, refreshAuthSession } from "@/lib/auth-session-client";
import { AUTH_READY_EVENT } from "@/lib/app-ready";
import { hideServerAppShell } from "@/lib/boot-splash";
import { clearClientSessionHint, hasClientSessionHint, setClientSessionHint, setClientDashboardHint } from "@/lib/client-session-hint";
import { runWhenIdle } from "@/lib/run-when-idle";
import { PUBLIC_ROUTES, ROUTES, isStaffAllowedPath, postLoginRoute } from "@/lib/routes";
import { isOwner, isChef } from "@/lib/permissions";
import { dashboardKindFromEmail } from "@/lib/session-dashboard";
import { TOTAL_ONBOARDING_STEPS } from "@/lib/onboarding-steps";
import { emailToUsername } from "@/lib/username";

const STAFF_STEP_CACHE_KEY = "y.staffStep";

type StaffStepCache = { uid: string; step: number; activated?: boolean };

/** `activated: null` for a record written before it was cached — unknown, not
 *  "not activated", which is the answer that shuts the staff app. */
type StaffProfile = { step: number; activated: boolean | null };

function readStaffStepCache(uid: string): StaffProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STAFF_STEP_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StaffStepCache;
    if (parsed.uid !== uid || typeof parsed.step !== "number") return null;
    return {
      step: parsed.step,
      activated: typeof parsed.activated === "boolean" ? parsed.activated : null,
    };
  } catch {
    return null;
  }
}

function writeStaffStepCache(uid: string, step: number, activated: boolean) {
  try {
    sessionStorage.setItem(STAFF_STEP_CACHE_KEY, JSON.stringify({ uid, step, activated }));
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
  /**
   * True for a non-owner who has finished the form but whom no owner has
   * activated yet. They are still an applicant, so the staff app stays shut
   * and they are held on the submitted screen.
   */
  staffAwaitingActivation: boolean;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  signOut: async () => {},
  staffCompletedStep: null,
  staffNeedsOnboarding: false,
  staffAwaitingActivation: false,
});

export function AuthProvider({
  children,
  initialHasSession = false,
}: {
  children: React.ReactNode;
  /** From server uid cookie — skip waiting on authStateReady for splash / gates. */
  initialHasSession?: boolean;
}) {
  const [user, setUser] = useState<User | null>(null);
  // Stay "loading" until authStateReady — initialHasSession only optimises
  // shell paint, not permission gates. Setting loading=false early made
  // owner-only pages redirect home while Firebase user was still null.
  const [loading, setLoading] = useState(true);
  const [authRestored, setAuthRestored] = useState(false);
  const [staffCompletedStep, setStaffCompletedStep] = useState<number | null>(null);
  // `null` until the server doc says one way or the other. Only an explicit
  // `false` shuts the staff app — see staffAwaitingActivation below.
  const [staffActivated, setStaffActivated] = useState<boolean | null>(null);
  // Gate onboarding redirects until Firestore has confirmed the profile —
  // offline/cache snapshots briefly sent completed staff to the notifications
  // prompt ("alarm screen") before the server doc arrived.
  const [staffProfileConfirmed, setStaffProfileConfirmed] = useState(false);
  // `null` while we haven't looked yet, `true` once the staff member has
  // seen (and accepted) the enable-notifications prompt, `false` if they
  // still owe us that step. Owners and chefs skip this entirely.
  const [notificationsPromptSeen, setNotificationsPromptSeen] = useState<boolean | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const loginRedirectStarted = useRef(false);
  const signOutStarted = useRef(false);

  useEffect(() => {
    if (!user) loginRedirectStarted.current = false;
  }, [user]);

  // Fresh /login visit with no server or client session hint — don't block the
  // form (or boot splash dismiss) on Firebase authStateReady.
  useEffect(() => {
    if (pathname !== ROUTES.login) return;
    if (initialHasSession || hasClientSessionHint()) return;
    window.dispatchEvent(new Event(AUTH_READY_EVENT));
  }, [pathname, initialHasSession]);

  useEffect(() => {
    let cancelled = false;
    let authReady = false;
    let authReadySent = false;
    let unsub: (() => void) | undefined;

    const emitAuthReady = () => {
      if (authReadySent || typeof window === "undefined") return;
      authReadySent = true;
      window.dispatchEvent(new Event(AUTH_READY_EVENT));
    };

    if (initialHasSession || hasClientSessionHint()) {
      emitAuthReady();
    }

    void (async () => {
      const [{ onAuthStateChanged, signOut: fbSignOut }, { getAuth }] = await Promise.all([
        import("firebase/auth"),
        import("@/lib/firebase"),
      ]);
      if (cancelled) return;

      const auth = getAuth();

      unsub = onAuthStateChanged(auth, (u) => {
        setUser(u);
        if (u) {
          void refreshAuthSession(u);
          setClientSessionHint();
          setClientDashboardHint(dashboardKindFromEmail(u.email));
          setLoading(false);
          emitAuthReady();
          if (isOwner(u)) {
            setStaffCompletedStep(null);
            setStaffActivated(null);
          } else if (isChef(u)) {
            setStaffCompletedStep(TOTAL_ONBOARDING_STEPS);
            setStaffActivated(true);
            setStaffProfileConfirmed(true);
          } else {
            const cached = readStaffStepCache(u.uid);
            setStaffCompletedStep(cached?.step ?? null);
            setStaffActivated(cached?.activated ?? null);
            if (cached && cached.step >= TOTAL_ONBOARDING_STEPS) {
              setStaffProfileConfirmed(true);
              setNotificationsPromptSeen(true);
            } else {
              setNotificationsPromptSeen(null);
              setStaffProfileConfirmed(false);
            }
          }
          return;
        }
        if (authReady) {
          setStaffCompletedStep(null);
          setStaffActivated(null);
          setNotificationsPromptSeen(null);
          setStaffProfileConfirmed(false);
          clearStaffStepCache();
          void clearAuthSession();
        }
      });

      await auth.authStateReady();
      if (cancelled) return;
      authReady = true;
      setAuthRestored(true);
      setLoading(false);
      emitAuthReady();
      if (!auth.currentUser) {
        setStaffCompletedStep(null);
        setStaffActivated(null);
        setNotificationsPromptSeen(null);
        setStaffProfileConfirmed(false);
        clearStaffStepCache();
        clearClientSessionHint();
        void clearAuthSession();
      }
    })();

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [initialHasSession]);

  // On auth-state change: backfill role/username on the staff_onboarding doc
  // AND subscribe to it so completedStep + notificationsPromptSeen stay in
  // sync with Firestore. A one-shot getDoc left the local state stale after
  // the notifications-prompt page flipped `notificationsPromptSeen` to true,
  // which caused the routing effect below to bounce the user between
  // /onboarding and /onboarding/notifications forever.
  useEffect(() => {
    if (loading || !user) {
      setStaffProfileConfirmed(false);
      return;
    }
    const username = emailToUsername(user.email ?? "").toLowerCase();
    const role = isOwner(user) ? "owner" : isChef(user) ? "chef" : "staff";

    let confirmFallback: ReturnType<typeof setTimeout> | undefined;
    let unsub: (() => void) | undefined;

    const cancelIdle = runWhenIdle(() => {
      void (async () => {
        const [{ doc, onSnapshot, setDoc, serverTimestamp }, { getDb }] = await Promise.all([
          import("firebase/firestore"),
          import("@/lib/firebase"),
        ]);
        const ref = doc(getDb(), "staff_onboarding", user.uid);

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

        if (isOwner(user)) return;
        if (isChef(user)) {
          setStaffCompletedStep(TOTAL_ONBOARDING_STEPS);
          setStaffActivated(true);
          setNotificationsPromptSeen(true);
          setStaffProfileConfirmed(true);
          return;
        }

        unsub = onSnapshot(
          ref,
          (snap) => {
            const data = snap.data() ?? {};
            const completed = typeof data.completedStep === "number" ? data.completedStep : 0;
            setStaffCompletedStep(completed);

            // Only a server snapshot may answer these. A cached snapshot
            // reports `false` for a field it hasn't synced yet, and the 800ms
            // confirm fallback below un-gates the routing effect whether or
            // not the server copy has landed — so on a slow start a staff
            // member who enabled notifications months ago was told to enable
            // them again, and one activated weeks ago would be sent back to
            // the submitted screen. Leaving them `null` means "not known
            // yet", and the routing effect only redirects on an explicit
            // `false`. The cache is written from here for the same reason:
            // it primes both fields on the next load, so it must never carry
            // an activation a cached snapshot only appeared to deny.
            if (!snap.metadata.fromCache) {
              const activated = !!data.activatedAt;
              writeStaffStepCache(user.uid, completed, activated);
              setStaffActivated(activated);
              setNotificationsPromptSeen(data.notificationsPromptSeen === true);
              setStaffProfileConfirmed(true);
              if (confirmFallback) clearTimeout(confirmFallback);
            }
          },
          () => {
            const fallback = readStaffStepCache(user.uid);
            setStaffCompletedStep(fallback?.step ?? 0);
            setStaffActivated(fallback?.activated ?? null);
            setNotificationsPromptSeen(true);
            setStaffProfileConfirmed(true);
          },
        );
      })();
    }, 0);

    confirmFallback = setTimeout(() => {
      setStaffProfileConfirmed(true);
    }, 800);

    return () => {
      cancelIdle();
      if (confirmFallback) clearTimeout(confirmFallback);
      unsub?.();
    };
  }, [user, loading]);

  const userIsOwner = isOwner(user);
  const userIsChef = isChef(user);
  const staffNeedsOnboarding =
    !!user &&
    !userIsOwner &&
    !userIsChef &&
    staffCompletedStep !== null &&
    staffCompletedStep < TOTAL_ONBOARDING_STEPS;

  /**
   * Submitted, but nobody has activated them.
   *
   * Finishing the form used to open the whole staff app, which meant the
   * roster, payslips and documents appeared before anyone had read what was
   * submitted. Until an owner presses Activate Employee they are an
   * applicant, so they stay on the submitted screen.
   *
   * `staffActivated === false` and not `!staffActivated`: `null` means the
   * server doc hasn't answered yet, and treating silence as a refusal would
   * bounce every activated employee to the submitted screen on a slow start.
   */
  const staffAwaitingActivation =
    !!user &&
    !userIsOwner &&
    !userIsChef &&
    staffCompletedStep !== null &&
    staffCompletedStep >= TOTAL_ONBOARDING_STEPS &&
    staffActivated === false;

  useEffect(() => {
    const isPublic = PUBLIC_ROUTES.has(pathname);

    // Sign-in handoff — wait for session cookies, then hard-navigate so iOS
    // PWA gets SSR HTML with the correct dash cookie (client router.refresh
    // often races the POST and leaves main empty).
    if (user && isPublic) {
      if (loginRedirectStarted.current) return;
      loginRedirectStarted.current = true;
      void (async () => {
        try {
          await refreshAuthSession(user);
        } catch {
          /* still navigate — dashboard renders from local hints */
        }
        let dest = postLoginRoute(user);
        if (staffNeedsOnboarding) {
          dest =
            notificationsPromptSeen === false
              ? ROUTES.staffNotificationsPrompt
              : ROUTES.staffOnboarding;
        } else if (staffAwaitingActivation) {
          dest = ROUTES.staffOnboardingComplete;
        }
        window.location.replace(dest);
      })();
      return;
    }

    if (!authRestored) return;
    if (!user && !isPublic) {
      router.replace(ROUTES.login);
      return;
    }
    // Wait until we know the staff's completedStep before routing them around
    // — otherwise we'd flash /staff before bouncing back to /onboarding.
    const userIsOwnerNow = isOwner(user);
    const userIsChefNow = isChef(user);
    if (user && !userIsOwnerNow && !userIsChefNow && !staffProfileConfirmed) return;

    const inOnboarding = pathname.startsWith(ROUTES.staffOnboarding);
    // Staff mid-onboarding still need access to /staff/settings so they
    // can toggle EN/JA while filling out the forms — treat it as an
    // allowed escape hatch alongside the onboarding routes themselves.
    const inSettings = pathname === "/staff/settings";

    // Chef landing on the staff app home — bounce to dashboard (sidebar Home is /).
    if (user && isChef(user) && pathname === ROUTES.staffHome) {
      router.replace(ROUTES.home);
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

    // Submitted and waiting on the owner — held on the submitted screen, with
    // the same /staff/settings escape hatch as staff still mid-form so they
    // can still flip the language toggle.
    if (
      user &&
      staffAwaitingActivation &&
      pathname !== ROUTES.staffOnboardingComplete &&
      !inSettings
    ) {
      router.replace(ROUTES.staffOnboardingComplete);
      return;
    }

    // Chefs skip onboarding wizard steps — overview + handbook/beer guide stay reachable.
    if (
      user &&
      isChef(user) &&
      pathname.startsWith(ROUTES.staffOnboarding) &&
      pathname !== ROUTES.staffOnboarding
    ) {
      router.replace(ROUTES.home);
      return;
    }

    // Completed non-owner trying to visit an owner-only path → bounce to Home.
    // Chefs have manager-level access so they are exempt from this restriction.
    if (user && !userIsOwnerNow && !userIsChefNow && !isStaffAllowedPath(pathname)) {
      router.replace(ROUTES.staffHome);
    }
  }, [user, authRestored, pathname, router, staffCompletedStep, staffNeedsOnboarding, staffAwaitingActivation, notificationsPromptSeen, staffProfileConfirmed]);

  /**
   * Sign out on the first press.
   *
   * Order matters. This used to await the session-cookie DELETE and only
   * then reach Firebase, so a press spent its first network round trip
   * doing nothing the user could see — and `clearClientSessionHint()` left
   * the client-readable `y_sess` cookie behind, so the shell kept believing
   * a session was live. Revoking Firebase locally is instant and needs no
   * network, so it goes first; clearing the server cookie is the slow part
   * and only the refresh below has to wait on it.
   */
  const signOut = async () => {
    if (signOutStarted.current) return;
    signOutStarted.current = true;

    // First thing, before even Firebase: void any session write already in
    // flight. `refreshAuthSession` runs from four places and takes a token
    // round trip before it POSTs, so one is often still in the air when the
    // button is pressed — and the POST re-mints `uid` and `y_sess` on the way
    // back. Bumping the epoch here rather than inside clearAuthSession() below
    // covers the whole press, not just the part after the DELETE goes out.
    beginAuthSessionTeardown();

    // try/finally, because the latch above is what makes the button single-
    // press. Without it, one rejection anywhere below — a chunk that fails to
    // load on a flaky connection is the realistic one — left the ref stuck at
    // `true` and every later press returned at the guard, so sign-out was
    // dead for the rest of the session with no way back but a reload.
    try {
      const [{ signOut: fbSignOut }, { getAuth }] = await Promise.all([
        import("firebase/auth"),
        import("@/lib/firebase"),
      ]);
      await fbSignOut(getAuth()).catch(() => {/* revoke the UI regardless */});

      clearStaffStepCache();
      clearClientSessionHint();
      document.documentElement.classList.remove("y-has-session");
      hideServerAppShell();
      document.getElementById("static-chrome-fallback")?.setAttribute("hidden", "");
      setUser(null);
      setLoading(false);
      router.replace(ROUTES.login);

      // The login page is server-rendered from the `uid` cookie, so it can only
      // be trusted once the DELETE has landed — refresh after, not before.
      await clearAuthSession();

      // Clear the hint a second time, after the DELETE. Every request made
      // while `uid` was still alive — including the /login navigation above —
      // passes through middleware that mints a fresh `y_sess=1` from it, so
      // one of those responses can land after the teardown and re-arm the
      // very cookie this sign-out cleared. The shell trusts `y_sess` over
      // Firebase, so a leftover one paints signed-in chrome over a signed-out
      // user: the press looks ignored, and the splash waits for a session
      // that is never coming.
      clearClientSessionHint();
      router.refresh();
    } finally {
      signOutStarted.current = false;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signOut,
        staffCompletedStep,
        staffNeedsOnboarding,
        staffAwaitingActivation,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
