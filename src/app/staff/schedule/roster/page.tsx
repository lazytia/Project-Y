"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { doc, getDoc, type Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { markRosterWeekSeen } from "@/lib/roster-seen";
import { positionLabelOf } from "@/lib/staff-display";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

/* ──────────────────────────────────────────────────────────────────────
 * Staff roster page — reads the published roster from the signed-in
 * user's staff_onboarding doc at roster.{weekStartISO}. The manager
 * writes this via publishStaffRoster() when they hit the Publish button
 * on /scheduling/roster.
 *
 * The whole `roster` map is read once rather than a single week, because
 * the arrows below move between weeks and a round trip per tap would make
 * them feel broken on a phone.
 * ──────────────────────────────────────────────────────────────────── */

type StoredShift = { iso: string; meal: "lunch" | "dinner"; start: string };

type RosterDoc = {
  weekStartISO: string;
  publishedAt?: Timestamp;
  shifts: StoredShift[];
};

type DayEntry = {
  date: Date;
  iso: string;
  shifts: StoredShift[];
};

/** Mon–Sun. The restaurant rarely rosters a Sunday, but it is part of the
 *  week and leaving it off made the strip end on an unexplained Saturday. */
const DAYS_IN_WEEK = 7;

/* ── helpers ── */

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
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

function fmtWeekRange(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "short",
    day: "numeric",
    month: "short",
  };
  return `${start.toLocaleDateString("en-AU", opts)} – ${end.toLocaleDateString("en-AU", opts)}`;
}

/** "10:00am" — lowercase and unspaced, as the shift rows render it. */
function fmtTime12h(t: string): string {
  if (!/^\d{1,2}:\d{2}$/.test(t)) return t;
  const [hStr, mStr] = t.split(":");
  let h = parseInt(hStr, 10);
  const period = h >= 12 ? "pm" : "am";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${mStr}${period}`;
}

/**
 * Hall or Kitchen, taken from the employee's own position.
 *
 * The roster stores a day, a meal and a start time — there is no section on
 * a shift — so this is the same on every row for a given person. Printing
 * their department is still worth the line: it is what the shift is, and a
 * kitchen hand and a waiter reading the same screen should not have to infer
 * it. If sections ever need to vary per shift, the manager's roster grid has
 * to grow the field first.
 */
function departmentOf(raw: Record<string, unknown>): string {
  return positionLabelOf(raw).replace(/\s*Staff$/, "");
}

/* ── page ── */

export default function StaffRosterPage() {
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [rosterMap, setRosterMap] = useState<Record<string, RosterDoc>>({});
  const [department, setDepartment] = useState("");

  const [today, setTodayDate] = useState<Date>(() => {
    const d = new Date(0);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  /** How many weeks away from the current one the user has paged. */
  const [weekOffset, setWeekOffset] = useState(0);

  useEffect(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    setTodayDate(d);
  }, []);

  const currentWeekStart = useMemo(() => startOfWeek(today), [today]);
  const weekStart = useMemo(
    () => addDays(currentWeekStart, weekOffset * DAYS_IN_WEEK),
    [currentWeekStart, weekOffset],
  );
  const weekStartISO = useMemo(() => isoDate(weekStart), [weekStart]);
  const weekEnd = useMemo(() => addDays(weekStart, DAYS_IN_WEEK - 1), [weekStart]);
  const weekDays = useMemo(
    () => Array.from({ length: DAYS_IN_WEEK }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const snap = await getDoc(doc(getDb(), "staff_onboarding", user.uid));
      const data = snap.data() ?? {};
      setRosterMap((data.roster ?? {}) as Record<string, RosterDoc>);
      setDepartment(departmentOf(data as Record<string, unknown>));
    } catch (err) {
      console.error("[staff-roster] load failed", err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading) load();
  }, [authLoading, load]);

  /**
   * Reading a week here is what clears its "Roster published" notice off the
   * dashboard. Recorded for whichever week is on screen, so paging forward to
   * next week counts as having seen next week — that is the week the notice
   * is usually about.
   */
  const seenWeeks = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (loading || !user) return;
    if (seenWeeks.current.has(weekStartISO)) return;
    seenWeeks.current.add(weekStartISO);
    void markRosterWeekSeen(user.uid, weekStartISO);
  }, [loading, user, weekStartISO]);

  const rosterDoc = rosterMap[weekStartISO] ?? null;

  const dayEntries: DayEntry[] = useMemo(() => {
    const shifts = rosterDoc?.shifts ?? [];
    return weekDays.map((d) => {
      const iso = isoDate(d);
      const dayShifts = shifts
        .filter((s) => s.iso === iso)
        .sort((a, b) => a.start.localeCompare(b.start));
      return { date: d, iso, shifts: dayShifts };
    });
  }, [rosterDoc, weekDays]);

  /** Every shift in the week, flattened into the order they are worked. */
  const weekShifts = useMemo(
    () => dayEntries.flatMap((de) => de.shifts.map((s) => ({ ...s, date: de.date }))),
    [dayEntries],
  );

  if (authLoading || loading) return <Splash />;

  const todayISO = isoDate(today);
  const notPublished = !rosterDoc;

  /**
   * Named relative to now, because "This Week" stops being true the moment
   * the arrows are used. Anything further out than a week either side is
   * read off the dates instead of invented a name for.
   */
  const weekTitle =
    weekOffset === 0 ? "This Week" : weekOffset === 1 ? "Next Week" : weekOffset === -1 ? "Last Week" : "Roster";

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{weekTitle}</h1>

      {/* Week range + paging */}
      <div className={styles.weekBar}>
        <p className={styles.weekRange}>{fmtWeekRange(weekStart, weekEnd)}</p>
        <div className={styles.weekNav}>
          {weekOffset !== 0 && (
            <button
              type="button"
              className={styles.todayPill}
              onClick={() => setWeekOffset(0)}
            >
              Today
            </button>
          )}
          <button
            type="button"
            className={styles.navBtn}
            onClick={() => setWeekOffset((w) => w - 1)}
            aria-label="Previous week"
          >
            ‹
          </button>
          <button
            type="button"
            className={styles.navBtn}
            onClick={() => setWeekOffset((w) => w + 1)}
            aria-label="Next week"
          >
            ›
          </button>
        </div>
      </div>

      {/* Day strip. The dot under a day means there is a shift on it — it is
          the one glance that answers "when am I in this week", so it carries
          information rather than sitting under every day as decoration. */}
      <ul className={styles.dayStrip}>
        {dayEntries.map((de) => {
          const isToday = de.iso === todayISO;
          const worked = de.shifts.length > 0;
          return (
            <li
              key={de.iso}
              className={`${styles.dayCell} ${isToday ? styles.dayCellToday : ""}`}
            >
              <span className={styles.dayName}>
                {de.date.toLocaleDateString("en-AU", { weekday: "short" })}
              </span>
              <span className={styles.dayNum}>{de.date.getDate()}</span>
              <span
                className={`${styles.dayDot} ${worked ? styles.dayDotOn : ""}`}
                aria-hidden="true"
              />
            </li>
          );
        })}
      </ul>

      {notPublished ? (
        <p className={styles.emptyText}>
          The roster for this week hasn&apos;t been published yet.
        </p>
      ) : weekShifts.length === 0 ? (
        <p className={styles.emptyText}>No shifts scheduled this week.</p>
      ) : (
        <>
          <h2 className={styles.countTitle}>
            {weekShifts.length} {weekShifts.length === 1 ? "Shift" : "Shifts"}
          </h2>

          {/* No chevron on these rows: a shift has no detail screen to open,
              and a row that looks tappable and goes nowhere is a control in
              name only. */}
          <ul className={styles.shiftList}>
            {weekShifts.map((s, i) => (
              <li key={`${s.iso}-${s.start}-${i}`} className={styles.shiftRow}>
                <div className={styles.shiftDate}>
                  <span className={styles.shiftDow}>
                    {s.date.toLocaleDateString("en-AU", { weekday: "short" })}
                  </span>
                  <span className={styles.shiftDay}>
                    {s.date.toLocaleDateString("en-AU", { day: "numeric", month: "short" })}
                  </span>
                </div>
                <div className={styles.shiftDivider} />
                <div className={styles.shiftBody}>
                  <p className={styles.shiftStart}>{fmtTime12h(s.start)} start</p>
                  {department && <p className={styles.shiftDept}>{department}</p>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Notes */}
      <h2 className={styles.notesTitle}>Notes</h2>
      <div className={styles.notesCard}>
        <span className={styles.notesIcon} aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="7" y1="8" x2="17" y2="8" />
            <line x1="7" y1="12" x2="17" y2="12" />
            <line x1="7" y1="16" x2="13" y2="16" />
          </svg>
        </span>
        <ul className={styles.notesList}>
          <li>Finish times may vary depending on service and operational needs.</li>
          <li>Check your notifications for any updates.</li>
          <li>If you are unsure, please speak to your manager.</li>
        </ul>
      </div>
    </div>
  );
}
