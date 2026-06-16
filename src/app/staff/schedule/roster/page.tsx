"use client";

import { useMemo } from "react";
import styles from "./page.module.css";

/* ──────────────────────────────────────────────────────────────────────
 * Placeholder roster — swap to Firestore once the manager-side roster
 * publishing UI lands. The shape is what the manager page will write to
 * staff_onboarding/{uid}.roster.{ISO Monday YYYY-MM-DD}.
 * ──────────────────────────────────────────────────────────────────── */

type Shift = {
  startTime: string;       // "HH:MM" 24h
  endTime: string;         // "HH:MM" 24h
  shiftName?: string;      // "Lunch Shift", "Dinner Shift", etc.
};

type DayRoster =
  | { kind: "off" }
  | { kind: "shift"; shift: Shift };

type WeekRoster = {
  weekStartISO: string;    // Monday YYYY-MM-DD
  publishedAtISO: string;
  // index by weekday number 1 (Mon) … 7 (Sun)
  days: Record<1 | 2 | 3 | 4 | 5 | 6 | 7, DayRoster>;
};

const ROSTER: WeekRoster = {
  weekStartISO: "2026-06-16",
  publishedAtISO: "2026-06-13",
  days: {
    1: { kind: "off" }, // Mon
    2: { kind: "shift", shift: { startTime: "11:00", endTime: "14:30", shiftName: "Lunch Shift" } },
    3: { kind: "shift", shift: { startTime: "11:00", endTime: "14:30", shiftName: "Lunch Shift" } },
    4: { kind: "shift", shift: { startTime: "11:00", endTime: "14:30", shiftName: "Lunch Shift" } },
    5: { kind: "shift", shift: { startTime: "11:00", endTime: "14:30", shiftName: "Lunch Shift" } },
    6: { kind: "shift", shift: { startTime: "17:00", endTime: "21:00", shiftName: "Dinner Shift" } },
    7: { kind: "off" }, // Sun
  },
};

const DAYS_LONG = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const SYDNEY_TZ = "Australia/Sydney";

/* ── time / date helpers ── */

function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function fmtDayShort(d: Date): string {
  return d.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function fmtWeekRange(start: Date, end: Date): string {
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  const left = start.toLocaleDateString("en-AU", {
    day: "numeric",
    month: sameMonth ? undefined : "short",
  });
  const right = end.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${left} – ${right}`;
}

function fmtDateLong(iso: string): string {
  return isoToDate(iso).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtTime12h(t: string): string {
  if (!/^\d{1,2}:\d{2}$/.test(t)) return t;
  const [hStr, mStr] = t.split(":");
  let h = parseInt(hStr, 10);
  const m = mStr;
  const period = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${period}`;
}

/** Compose a Date for a specific day in the roster at the given clock time. */
function buildDateAt(weekStartISO: string, weekdayIdx: number, hhmm: string): Date {
  const start = isoToDate(weekStartISO);
  const day = addDays(start, weekdayIdx - 1);
  const [h, m] = hhmm.split(":").map(Number);
  day.setHours(h, m, 0, 0);
  return day;
}

function hoursBetween(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return Math.max(0, (eh * 60 + em - (sh * 60 + sm))) / 60;
}

function nowInSydney(): Date {
  // The placeholder data is fictitious; we just compute relative-to-the-current
  // device clock. Once the real roster lands this will use server-time.
  return new Date();
}

function fmtRelative(target: Date): string {
  const now = nowInSydney();
  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) return "In progress";
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 60) return `Starts in ${minutes} min${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `Starts in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `Starts in ${days} day${days === 1 ? "" : "s"}`;
}

/* ── page ── */

export default function StaffRosterPage() {
  const weekStart = isoToDate(ROSTER.weekStartISO);
  const weekEnd = addDays(weekStart, 6);

  // Find the next shift relative to "now". Falls back to the first shift if
  // every shift this week is in the past.
  const nextShift = useMemo(() => {
    const now = nowInSydney();
    for (let i = 1 as 1 | 2 | 3 | 4 | 5 | 6 | 7; i <= 7; i = (i + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7) {
      const r = ROSTER.days[i];
      if (r.kind !== "shift") continue;
      const start = buildDateAt(ROSTER.weekStartISO, i, r.shift.startTime);
      if (start.getTime() >= now.getTime()) {
        return { weekday: i, shift: r.shift, startDate: start };
      }
    }
    // fall back: earliest shift
    for (let i = 1 as 1 | 2 | 3 | 4 | 5 | 6 | 7; i <= 7; i = (i + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7) {
      const r = ROSTER.days[i];
      if (r.kind === "shift") {
        const start = buildDateAt(ROSTER.weekStartISO, i, r.shift.startTime);
        return { weekday: i, shift: r.shift, startDate: start };
      }
    }
    return null;
  }, []);

  const totals = useMemo(() => {
    let shifts = 0;
    let hours = 0;
    for (let i = 1 as 1 | 2 | 3 | 4 | 5 | 6 | 7; i <= 7; i = (i + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7) {
      const r = ROSTER.days[i];
      if (r.kind === "shift") {
        shifts += 1;
        hours += hoursBetween(r.shift.startTime, r.shift.endTime);
      }
    }
    return { shifts, hours };
  }, []);

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Roster</h1>

      {/* This Week label */}
      <div className={styles.weekLabel}>
        <p className={styles.weekTitle}>This Week</p>
        <p className={styles.weekRange}>{fmtWeekRange(weekStart, weekEnd)}</p>
      </div>

      {/* Next Shift hero */}
      {nextShift ? (
        <section className={styles.nextCard}>
          <div className={styles.nextHeader}>
            <div>
              <p className={styles.nextLabel}>Next Shift</p>
              <p className={styles.nextDate}>
                {fmtDayShort(addDays(weekStart, nextShift.weekday - 1))}
              </p>
              <p className={styles.nextTime}>{fmtTime12h(nextShift.shift.startTime)}</p>
              <p className={styles.nextTimeKicker}>START</p>
            </div>
            <span className={styles.nextIcon} aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </span>
          </div>

          <div className={styles.nextDivider} />

          <p className={styles.nextSubLabel}>Expected Finish</p>
          <p className={styles.nextFinish}>{fmtTime12h(nextShift.shift.endTime)}</p>
          {nextShift.shift.shiftName && (
            <p className={styles.nextShiftName}>{nextShift.shift.shiftName}</p>
          )}

          <p className={styles.nextRelative}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            {fmtRelative(nextShift.startDate)}
          </p>
        </section>
      ) : (
        <p className={styles.emptyText}>No shifts scheduled this week.</p>
      )}

      {/* Week breakdown */}
      <h2 className={styles.sectionTitle}>This Week</h2>
      <ul className={styles.weekList}>
        {DAYS_LONG.map((_, idx) => {
          const weekday = (idx + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
          const day = addDays(weekStart, idx);
          const r = ROSTER.days[weekday];
          return (
            <li key={weekday} className={styles.weekRow}>
              <span className={styles.weekDay}>{fmtDayShort(day)}</span>
              {r.kind === "off" ? (
                <span className={styles.offBadge}>OFF</span>
              ) : (
                <div className={styles.weekShift}>
                  <span className={styles.weekStart}>
                    {fmtTime12h(r.shift.startTime)} Start
                  </span>
                  <span className={styles.weekFinish}>
                    Expected {fmtTime12h(r.shift.endTime)}
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Totals */}
      <div className={styles.statsCard}>
        <div className={styles.statBlock}>
          <span className={styles.statIcon} aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </span>
          <p className={styles.statValue}>{totals.shifts}</p>
          <p className={styles.statLabel}>Shifts</p>
        </div>
        <div className={styles.statDivider} />
        <div className={styles.statBlock}>
          <span className={styles.statIcon} aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </span>
          <p className={styles.statValue}>
            {totals.hours % 1 === 0 ? totals.hours.toString() : totals.hours.toFixed(1)}
          </p>
          <p className={styles.statLabel}>Hours</p>
        </div>
      </div>

      {/* Roster published */}
      <div className={styles.publishedCard}>
        <span className={styles.publishedIcon} aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </span>
        <div className={styles.publishedBody}>
          <p className={styles.publishedTitle}>Roster Published</p>
          <p className={styles.publishedDate}>{fmtDateLong(ROSTER.publishedAtISO)}</p>
        </div>
      </div>
    </div>
  );
}
