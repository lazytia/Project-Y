"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { doc, getDoc, setDoc, serverTimestamp, type Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import styles from "./page.module.css";

/**
 * Placeholder shifts / pay date until the real backend is wired up.
 * Hardcoded so the layout reads naturally during design review.
 */
const NEXT_SHIFT = {
  date: new Date("2026-06-15T11:00:00+10:00"),
  shift: "Lunch",
  startTime: "11:00 AM",
};

const NEXT_PAY_DATE = new Date("2026-06-18T00:00:00+10:00");

type StoredNotification = {
  id: string;
  kind?: string;
  title?: string;
  detail?: string;
  createdAt?: Timestamp;
};

type Notification = {
  id: string;
  label: string;
  detail: string;
  createdAt: Date | null;
  ago: string;
};

function fmtShiftDate(d: Date): string {
  return d.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function tsToDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object" && v !== null && "toDate" in (v as object)) {
    try { return (v as Timestamp).toDate(); } catch { return null; }
  }
  return null;
}

function fmtRelative(d: Date | null): string {
  if (!d) return "";
  const diff = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const days = Math.floor(diff / 86400);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

export default function StaffDashboardPage() {
  const { user } = useAuth();
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  // Fetch the signed-in user's notifications from staff_onboarding/{uid}
  // AND stamp notificationsReadAt so the top-bar bell dot clears once they
  // open the Home page.
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const ref = doc(getDb(), "staff_onboarding", user.uid);
        const snap = await getDoc(ref);
        const data = snap.data() ?? {};
        const arr = (data.notifications ?? []) as StoredNotification[];
        const parsed: Notification[] = arr
          .map((n) => {
            const d = tsToDate(n.createdAt);
            return {
              id: n.id,
              label: n.title ?? "Notification",
              detail: n.detail ?? "",
              createdAt: d,
              ago: fmtRelative(d),
            };
          })
          .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
        setNotifications(parsed);
        // Best-effort: mark notifications as read.
        await setDoc(
          ref,
          { notificationsReadAt: serverTimestamp() },
          { merge: true },
        ).catch(() => {});
      } catch {
        /* ignore */
      }
    })();
  }, [user]);

  // Lock body scroll while the modal is open.
  useEffect(() => {
    if (!notifOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [notifOpen]);

  // Close on Escape.
  useEffect(() => {
    if (!notifOpen) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setNotifOpen(false); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [notifOpen]);

  // Show only the top 2 on the dashboard card; the rest live in the modal.
  const preview = notifications.slice(0, 2);

  return (
    <div className={styles.page}>
      {/* Next Shift */}
      <Link href="/staff/schedule/roster" className={styles.shiftCard}>
        <div className={styles.shiftIcon} aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </div>
        <div className={styles.shiftBody}>
          <p className={styles.shiftLabel}>Next Shift</p>
          <p className={styles.shiftDate}>{fmtShiftDate(NEXT_SHIFT.date)}</p>
          <p className={styles.shiftTime}>
            {NEXT_SHIFT.startTime} - {NEXT_SHIFT.shift}
          </p>
        </div>
        <span className={styles.chevron} aria-hidden="true">›</span>
      </Link>

      {/* Notifications */}
      <section className={styles.notifCard}>
        <div className={styles.notifHeader}>
          <p className={styles.notifTitle}>Notifications</p>
          {notifications.length > 0 && (
            <button
              type="button"
              className={styles.notifLink}
              onClick={() => setNotifOpen(true)}
            >
              View all <span aria-hidden="true">›</span>
            </button>
          )}
        </div>
        {notifications.length === 0 ? (
          <p className={styles.notifEmpty}>No notifications yet.</p>
        ) : (
          <ul className={styles.notifList}>
            {preview.map((n) => (
              <li key={n.id} className={styles.notifItem}>
                <span className={styles.notifDot} aria-hidden="true" />
                <span className={styles.notifText}>{n.label}</span>
                <span className={styles.notifAgo}>{n.ago}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Next Pay Date */}
      <Link href="/staff/payslips" className={styles.payCard}>
        <div className={styles.payIcon} aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8" />
            <line x1="12" y1="6" x2="12" y2="8" />
            <line x1="12" y1="16" x2="12" y2="18" />
          </svg>
        </div>
        <div className={styles.payBody}>
          <p className={styles.payLabel}>Next Pay Date</p>
          <p className={styles.payDate}>{fmtShiftDate(NEXT_PAY_DATE)}</p>
        </div>
        <span className={styles.chevron} aria-hidden="true">›</span>
      </Link>

      {/* Quick Actions */}
      <section className={styles.quickSection}>
        <h2 className={styles.quickTitle}>Quick Actions</h2>

        <Link href="/staff/schedule/request-holiday" className={styles.quickRow}>
          <span className={styles.quickIcon} aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </span>
          <span className={styles.quickLabel}>Request Holiday</span>
          <span className={styles.chevron} aria-hidden="true">›</span>
        </Link>

        <Link href="/staff/schedule/availability-change" className={styles.quickRow}>
          <span className={styles.quickIcon} aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </span>
          <span className={styles.quickLabel}>Availability Change</span>
          <span className={styles.chevron} aria-hidden="true">›</span>
        </Link>
      </section>

      {notifOpen && (
        <div
          className={styles.modalBackdrop}
          onClick={() => setNotifOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="All notifications"
        >
          <div
            className={styles.modal}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Notifications</h2>
              <button
                type="button"
                className={styles.modalClose}
                onClick={() => setNotifOpen(false)}
                aria-label="Close"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <ul className={styles.modalList}>
              {notifications.map((n) => (
                <li key={n.id} className={styles.modalItem}>
                  <span className={styles.modalDot} aria-hidden="true" />
                  <div className={styles.modalItemBody}>
                    <div className={styles.modalItemTopRow}>
                      <span className={styles.modalItemTitle}>{n.label}</span>
                      <span className={styles.modalItemAgo}>{n.ago}</span>
                    </div>
                    <p className={styles.modalItemDetail}>{n.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
