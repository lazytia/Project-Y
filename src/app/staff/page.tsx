"use client";

import Link from "next/link";
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

const NOTIFICATIONS = [
  { id: 1, label: "Holiday request approved", ago: "2h ago" },
  { id: 2, label: "New roster published", ago: "5h ago" },
];

function fmtShiftDate(d: Date): string {
  return d.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export default function StaffDashboardPage() {
  return (
    <div className={styles.page}>
      <div className={styles.brandRow}>
        <h1 className={styles.brand}>YURICA</h1>
        <button
          type="button"
          className={styles.bellBtn}
          aria-label="Notifications"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          <span className={styles.bellDot} aria-hidden="true" />
        </button>
      </div>

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
          <Link href="/staff" className={styles.notifLink}>
            View all <span aria-hidden="true">›</span>
          </Link>
        </div>
        <ul className={styles.notifList}>
          {NOTIFICATIONS.map((n) => (
            <li key={n.id} className={styles.notifItem}>
              <span className={styles.notifDot} aria-hidden="true" />
              <span className={styles.notifText}>{n.label}</span>
              <span className={styles.notifAgo}>{n.ago}</span>
            </li>
          ))}
        </ul>
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
    </div>
  );
}
