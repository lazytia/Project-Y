"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { doc, getDoc, setDoc, serverTimestamp, type Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { useLang } from "@/components/LanguageProvider";
import styles from "./page.module.css";

/* ── types ── */

type StoredShift = { iso: string; meal: "lunch" | "dinner"; start: string };

type RosterDoc = {
  weekStartISO: string;
  publishedAt?: Timestamp;
  shifts: StoredShift[];
};

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

type NextShiftInfo = {
  date: Date;
  meal: "lunch" | "dinner";
  startTime: string;
  startDate: Date;
};

/* ── helpers ── */

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7; // 0=Mon
  x.setDate(x.getDate() - dow);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtShiftDate(d: Date): string {
  return d.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function fmtTime12h(t: string): string {
  if (!/^\d{1,2}:\d{2}$/.test(t)) return t;
  const [hStr, mStr] = t.split(":");
  let h = parseInt(hStr, 10);
  const period = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${mStr} ${period}`;
}

function mealLabelKey(m: "lunch" | "dinner"): string {
  return m === "lunch" ? "staff.lunch" : "staff.dinner";
}

function tsToDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object" && v !== null && "toDate" in (v as object)) {
    try { return (v as Timestamp).toDate(); } catch { return null; }
  }
  return null;
}

function fmtRelative(
  d: Date | null,
  t: (key: string) => string,
): string {
  if (!d) return "";
  const diff = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (diff < 60) return t("staff.time.justNow");
  if (diff < 3600) return `${Math.floor(diff / 60)}${t("staff.time.mAgo")}`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}${t("staff.time.hAgo")}`;
  const days = Math.floor(diff / 86400);
  if (days < 7) return `${days}${t("staff.time.dAgo")}`;
  const weeks = Math.floor(days / 7);
  return `${weeks}${t("staff.time.wAgo")}`;
}

/** Find the nearest upcoming shift across this week and next week rosters. */
function findNextShift(
  thisWeekRoster: RosterDoc | null,
  nextWeekRoster: RosterDoc | null,
): NextShiftInfo | null {
  const now = new Date();
  const candidates: NextShiftInfo[] = [];

  for (const roster of [thisWeekRoster, nextWeekRoster]) {
    if (!roster) continue;
    for (const s of roster.shifts) {
      const [y, m, d] = s.iso.split("-").map(Number);
      const [hh, mm] = s.start.split(":").map(Number);
      const date = new Date(y, m - 1, d, 0, 0, 0, 0);
      const startDate = new Date(y, m - 1, d, hh, mm, 0, 0);
      candidates.push({ date, meal: s.meal, startTime: s.start, startDate });
    }
  }

  candidates.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  // Only show future shifts — never fall back to past ones
  return candidates.find((c) => c.startDate.getTime() >= now.getTime()) ?? null;
}

/* ── page ── */

export default function StaffDashboardPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [nextShift, setNextShift] = useState<NextShiftInfo | null>(null);
  const [shiftLoaded, setShiftLoaded] = useState(false);

  const [today, setTodayDate] = useState<Date>(() => {
    const d = new Date(0);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  useEffect(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    setTodayDate(d);
  }, []);

  const thisWeekISO = useMemo(() => isoDate(startOfWeek(today)), [today]);
  const nextWeekISO = useMemo(() => isoDate(addDays(startOfWeek(today), 7)), [today]);

  // Load roster + notifications from staff_onboarding/{uid}
  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      const ref = doc(getDb(), "staff_onboarding", user.uid);
      const snap = await getDoc(ref);
      const data = snap.data() ?? {};

      // Roster — check this week + next week
      const thisRoster = (data.roster?.[thisWeekISO] ?? null) as RosterDoc | null;
      const nextRoster = (data.roster?.[nextWeekISO] ?? null) as RosterDoc | null;
      setNextShift(findNextShift(thisRoster, nextRoster));
      setShiftLoaded(true);

      // Notifications
      const arr = (data.notifications ?? []) as StoredNotification[];
      const parsed: Notification[] = arr
        .map((n) => {
          const d = tsToDate(n.createdAt);
          return {
            id: n.id,
            label: n.title ?? t("staff.notif.title"),
            detail: n.detail ?? "",
            createdAt: d,
            ago: fmtRelative(d, t),
          };
        })
        .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
      setNotifications(parsed);

      // Best-effort: mark notifications as read.
      await setDoc(ref, { notificationsReadAt: serverTimestamp() }, { merge: true }).catch(() => {});
    } catch {
      setShiftLoaded(true);
    }
  }, [user, thisWeekISO, nextWeekISO, t]);

  useEffect(() => { loadData(); }, [loadData]);

  // Re-fetch data when the app becomes visible (e.g. after tapping a push notification)
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") loadData();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadData]);

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

  // Next Friday pay date
  const [nextPayDate, setNextPayDate] = useState<Date | null>(null);

  useEffect(() => {
    const d = new Date();
    const dow = d.getDay(); // 0=Sun
    const daysUntilFri = (5 - dow + 7) % 7 || 7; // if today is Fri, show next Fri
    const fri = new Date(d);
    fri.setDate(d.getDate() + daysUntilFri);
    fri.setHours(0, 0, 0, 0);
    setNextPayDate(fri);
  }, []);

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
          <p className={styles.shiftLabel}>{t("staff.nextShift")}</p>
          {!shiftLoaded ? (
            <p className={styles.shiftDate}>{t("staff.loading")}</p>
          ) : nextShift ? (
            <>
              <p className={styles.shiftDate}>{fmtShiftDate(nextShift.date)}</p>
              <p className={styles.shiftTime}>
                {fmtTime12h(nextShift.startTime)} - {t(mealLabelKey(nextShift.meal))}
              </p>
            </>
          ) : (
            <p className={styles.shiftDate}>{t("staff.noUpcoming")}</p>
          )}
        </div>
        <span className={styles.chevron} aria-hidden="true">›</span>
      </Link>

      {/* Notifications */}
      <section className={styles.notifCard}>
        <div className={styles.notifHeader}>
          <p className={styles.notifTitle}>{t("staff.notif.title")}</p>
          {notifications.length > 0 && (
            <button
              type="button"
              className={styles.notifLink}
              onClick={() => setNotifOpen(true)}
            >
              {t("staff.notif.viewAll")} <span aria-hidden="true">›</span>
            </button>
          )}
        </div>
        {notifications.length === 0 ? (
          <p className={styles.notifEmpty}>{t("staff.notif.empty")}</p>
        ) : (
          <ul className={styles.notifList}>
            {preview.map((n) => (
              <li key={n.id} className={styles.notifItem}>
                <span className={styles.notifDot} aria-hidden="true" />
                <Link href={`/staff/notifications/${n.id}`} className={styles.notifText}>
                  {n.label}
                </Link>
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
          <p className={styles.payLabel}>{t("staff.nextPay")}</p>
          <p className={styles.payDate}>{nextPayDate ? fmtShiftDate(nextPayDate) : "—"}</p>
        </div>
        <span className={styles.chevron} aria-hidden="true">›</span>
      </Link>

      {/* Quick Actions */}
      <section className={styles.quickSection}>
        <h2 className={styles.quickTitle}>{t("staff.quickActions")}</h2>

        <Link href="/staff/schedule/request-holiday" className={styles.quickRow}>
          <span className={styles.quickIcon} aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </span>
          <span className={styles.quickLabel}>{t("staff.requestHoliday")}</span>
          <span className={styles.chevron} aria-hidden="true">›</span>
        </Link>

        <Link href="/staff/schedule/availability-change" className={styles.quickRow}>
          <span className={styles.quickIcon} aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </span>
          <span className={styles.quickLabel}>{t("staff.availabilityChange")}</span>
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
              <h2 className={styles.modalTitle}>{t("staff.notif.modalTitle")}</h2>
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
                  <Link
                    href={`/staff/notifications/${n.id}`}
                    className={styles.modalItemBody}
                    onClick={() => setNotifOpen(false)}
                  >
                    <div className={styles.modalItemTopRow}>
                      <span className={styles.modalItemTitle}>{n.label}</span>
                      <span className={styles.modalItemAgo}>{n.ago}</span>
                    </div>
                    <p className={styles.modalItemDetail}>{n.detail}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
