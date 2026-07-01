"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Sidebar from "./Sidebar";
import Splash from "./Splash";
import { useAuth } from "./AuthProvider";
import { PUBLIC_ROUTES } from "@/lib/routes";
import { isOwner, isChef } from "@/lib/permissions";
import { useBellInbox, type BellItem } from "@/hooks/useBellDot";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import styles from "./AppShell.module.css";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, loading, staffCompletedStep } = useAuth();
  const isPublic = PUBLIC_ROUTES.has(pathname);
  // 모바일: 기본 닫힘 / 데스크탑: CSS에서 항상 강제 표시
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (loading) {
    return <Splash />;
  }

  if (isPublic) {
    return <div className={styles.public}>{children}</div>;
  }

  if (!user) {
    return <Splash label="Redirecting…" />;
  }

  // Staff: wait for completedStep to load before rendering anything, so we
  // don't flash /staff before AuthProvider bounces them to /onboarding.
  if (!isOwner(user) && !isChef(user) && staffCompletedStep === null) {
    return <Splash />;
  }

  return <Shell sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen}>{children}</Shell>;
}

/**
 * Inner shell — split out so we can use the useBellDot hook after the early
 * returns above without violating the rules of hooks.
 */
function Shell({
  sidebarOpen,
  setSidebarOpen,
  children,
}: {
  sidebarOpen: boolean;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const { items, bellSeenAt, reload } = useBellInbox();
  const [bellOpen, setBellOpen] = useState(false);
  const seenMs = bellSeenAt?.getTime() ?? 0;
  const showBellDot = items.some((it) => (it.occurredAt?.getTime() ?? 0) > seenMs);

  // Lock body scroll while the modal is open.
  useEffect(() => {
    if (!bellOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [bellOpen]);

  // Close on Escape.
  useEffect(() => {
    if (!bellOpen) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setBellOpen(false); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bellOpen]);

  async function handleBellClick() {
    // Open the modal regardless of dot state so the user can still review
    // pending items (e.g. managers checking what's outstanding).
    setBellOpen(true);
    if (!user) return;
    // Stamp bellSeenAt = now() on the user's own doc. The next reload
    // recomputes the dot — every current item.occurredAt is now ≤ seenAt,
    // so the dot goes dark even though the modal can still show items.
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
    <div className={styles.shell}>
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
      <main className={styles.main}>{children}</main>

      {bellOpen && (
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
