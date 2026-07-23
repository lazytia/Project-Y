"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Sidebar from "./Sidebar";
import Splash from "./Splash";
import AppReadyMarker from "./AppReadyMarker";
import { useAuth } from "./AuthProvider";
import { PUBLIC_ROUTES } from "@/lib/routes";
import { isOwner, isChef } from "@/lib/permissions";
import { fetchSessionHint } from "@/lib/auth-session-client";
import { runWhenIdle } from "@/lib/run-when-idle";
import { useBellInbox, type BellItem } from "@/hooks/useBellDot";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import styles from "./AppShell.module.css";
import skeletonStyles from "./AppShellSkeleton.module.css";

type AppShellProps = {
  children: React.ReactNode;
  /** Set from the server uid cookie — enables optimistic shell before /api/auth/session. */
  initialHasSession?: boolean;
};

export default function AppShell({ children, initialHasSession = false }: AppShellProps) {
  const pathname = usePathname();
  const { user, loading, staffCompletedStep } = useAuth();
  const isPublic = PUBLIC_ROUTES.has(pathname);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessionVerified, setSessionVerified] = useState<boolean | null>(
    initialHasSession ? true : null,
  );

  useEffect(() => {
    if (isPublic) {
      setSessionVerified(false);
      return;
    }
    if (initialHasSession) return;
    if (typeof document !== "undefined" && document.cookie.includes("uid=")) {
      setSessionVerified(true);
      return;
    }
    let cancelled = false;
    void fetchSessionHint().then((hint) => {
      if (!cancelled) setSessionVerified(hint.authenticated);
    });
    return () => { cancelled = true; };
  }, [isPublic, pathname, initialHasSession]);

  const hasSessionGuess = initialHasSession || sessionVerified === true;
  const authSettled = !loading;
  const awaitingStaffStep =
    !!user && !isOwner(user) && !isChef(user) && staffCompletedStep === null;
  const usePlaceholderChrome =
    (!isPublic && !user && loading && hasSessionGuess) || (!isPublic && awaitingStaffStep);

  useEffect(() => {
    const el = document.getElementById("server-app-shell");
    if (!el) return;
    if (user && !loading) {
      el.setAttribute("hidden", "");
    } else if (usePlaceholderChrome) {
      el.setAttribute("hidden", "");
    } else if (initialHasSession && loading && !user) {
      el.removeAttribute("hidden");
    } else if (!loading && !user) {
      el.setAttribute("hidden", "");
    }
  }, [user, loading, usePlaceholderChrome, initialHasSession]);

  if (isPublic) {
    return (
      <>
        <AppReadyMarker />
        <div className={styles.public} data-app-shell="true">{children}</div>
      </>
    );
  }

  if (loading && !hasSessionGuess) {
    return null;
  }

  if (!loading && !user) {
    return (
      <>
        <AppReadyMarker />
        <Splash label="Redirecting…" />
      </>
    );
  }

  return (
    <>
      {authSettled && <AppReadyMarker />}
      <AuthenticatedShell
        interactive={!!user && !awaitingStaffStep}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
      >
        {children}
      </AuthenticatedShell>
    </>
  );
}

function PlaceholderChrome() {
  return (
    <>
      <div className={skeletonStyles.mobileHeader} aria-hidden="true">
        <div className={skeletonStyles.hamburgerPlaceholder} />
        <span className={skeletonStyles.mobileBrand}>YURICA</span>
        <div className={skeletonStyles.bellPlaceholder} />
      </div>
      <aside className={skeletonStyles.sidebarPlaceholder} aria-hidden="true">
        <div className={skeletonStyles.sidebarBrand} />
        <div className={skeletonStyles.sidebarItem} />
        <div className={skeletonStyles.sidebarItem} />
        <div className={skeletonStyles.sidebarItem} />
        <div className={skeletonStyles.sidebarItem} />
      </aside>
    </>
  );
}

function AuthenticatedShell({
  interactive,
  sidebarOpen,
  setSidebarOpen,
  children,
}: {
  interactive: boolean;
  sidebarOpen: boolean;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const [bellFetchEnabled, setBellFetchEnabled] = useState(false);

  useEffect(() => {
    if (!interactive) return;
    return runWhenIdle(() => setBellFetchEnabled(true), 2500);
  }, [interactive]);

  const { items, bellSeenAt, reload } = useBellInbox({ enabled: bellFetchEnabled && interactive });
  const [bellOpen, setBellOpen] = useState(false);
  const seenMs = bellSeenAt?.getTime() ?? 0;
  const showBellDot = items.some((it) => (it.occurredAt?.getTime() ?? 0) > seenMs);

  useEffect(() => {
    if (!bellOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [bellOpen]);

  useEffect(() => {
    if (!bellOpen) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setBellOpen(false); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bellOpen]);

  async function handleBellClick() {
    if (!bellFetchEnabled) setBellFetchEnabled(true);
    setBellOpen(true);
    if (!user) return;
    try {
      await setDoc(
        doc(getDb(), "staff_onboarding", user.uid),
        { bellSeenAt: serverTimestamp() },
        { merge: true },
      );
      reload();
    } catch {
      /* swallow */
    }
  }

  function handleItemClick(item: BellItem) {
    setBellOpen(false);
    reload();
    if (item.href) router.push(item.href);
  }

  return (
    <div className={styles.shell} data-app-shell="true">
      {interactive ? (
        <>
          <div className={styles.mobileHeader}>
            <button
              className={styles.hamburger}
              onClick={() => setSidebarOpen((o) => !o)}
              aria-label={sidebarOpen ? "Close menu" : "Open menu"}
            >
              <span className={styles.bar} />
              <span className={styles.bar} />
              <span className={styles.bar} />
            </button>
            <span className={styles.mobileBrand}>YURICA</span>
            <button
              type="button"
              className={styles.bellBtn}
              aria-label="Notifications"
              onClick={handleBellClick}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {showBellDot && <span className={styles.bellDot} aria-hidden="true" />}
            </button>
          </div>
          {sidebarOpen && (
            <div
              className={styles.backdrop}
              onClick={() => setSidebarOpen(false)}
              aria-hidden="true"
            />
          )}
          <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        </>
      ) : (
        <PlaceholderChrome />
      )}
      <main className={styles.main}>{children}</main>

      {interactive && bellOpen && (
        <div
          className={styles.bellBackdrop}
          onClick={(e) => { if (e.target === e.currentTarget) setBellOpen(false); }}
          role="dialog"
          aria-modal="true"
          aria-label="New notifications"
        >
          <div className={styles.bellModal}>
            <div className={styles.bellHeader}>
              <h2 className={styles.bellTitle}>New</h2>
              <button
                type="button"
                className={styles.bellClose}
                onClick={() => setBellOpen(false)}
                aria-label="Close"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            {items.length === 0 ? (
              <p className={styles.bellEmpty}>You&rsquo;re all caught up.</p>
            ) : (
              <ul className={styles.bellList}>
                {items.map((it) => (
                  <li key={it.id}>
                    <button
                      type="button"
                      className={styles.bellItem}
                      onClick={() => handleItemClick(it)}
                    >
                      <span className={styles.bellDotMini} aria-hidden="true" />
                      <div className={styles.bellItemBody}>
                        <div className={styles.bellItemTop}>
                          <span className={styles.bellItemTitle}>{it.title}</span>
                          {it.ago && <span className={styles.bellItemAgo}>{it.ago}</span>}
                        </div>
                        {it.detail && (
                          <p className={styles.bellItemDetail}>{it.detail}</p>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
