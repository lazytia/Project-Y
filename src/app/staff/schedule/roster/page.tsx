"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { doc, getDoc, type Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

/* ──────────────────────────────────────────────────────────────────────
 * Staff roster page — reads the published roster from the signed-in
 * user's staff_onboarding doc at roster.{weekStartISO}. The manager
 * writes this via publishStaffRoster() when they hit the Publish button
 * on /scheduling/roster.
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

const DAYS_IN_WEEK = 6; // Mon–Sat (restaurant schedule)
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

function fmtDayShort(d: Date): string {
  return d.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function fmtWeekRange(start: Date, end: Date): string {
  const sameMonth =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth();
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

function fmtTime12h(t: string): string {
  if (!/^\d{1,2}:\d{2}$/.test(t)) return t;
  const [hStr, mStr] = t.split(":");
  let h = parseInt(hStr, 10);
  const period = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${mStr} ${period}`;
}

function fmtRelative(target: Date): string {
  const now = new Date();
  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) return "In progress";
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 60) return `Starts in ${minutes} min${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `Starts in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `Starts in ${days} day${days === 1 ? "" : "s"}`;
}

function tsDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object" && v !== null && "toDate" in (v as object)) {
    try { return (v as Timestamp).toDate(); } catch { return null; }
  }
  return null;
}

function mealLabel(meal: "lunch" | "dinner"): string {
  return meal === "lunch" ? "Lunch" : "Dinner";
}

/* ── page ── */

export default function StaffRosterPage() {
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [rosterDoc, setRosterDoc] = useState<RosterDoc | null>(null);

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
  const weekStart = useMemo(() => startOfWeek(today), [today]);
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
      const roster = data.roster?.[weekStartISO] as RosterDoc | undefined;
      setRosterDoc(roster ?? null);
    } catch (err) {
      console.error("[staff-roster] load failed", err);
    } finally {
      setLoading(false);
    }
  }, [user, weekStartISO]);

  useEffect(() => {
    if (!authLoading) load();
  }, [authLoading, load]);

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

  const nextShift = useMemo(() => {
    if (!today.getTime()) return null;
    const now = today;
    const allShifts = dayEntries.flatMap((de) =>
      de.shifts.map((s) => {
        const [h, m] = s.start.split(":").map(Number);
        const dt = new Date(de.date);
        dt.setHours(h, m, 0, 0);
        return { ...s, date: de.date, startDate: dt };
      }),
    );
    const upcoming = allShifts
      .filter((s) => s.startDate.getTime() >= now.getTime())
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
    return upcoming[0] ?? allShifts.sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0] ?? null;
  }, [dayEntries, today]);

  const totalShifts = useMemo(
    () => dayEntries.reduce((sum, de) => sum + de.shifts.length, 0),
    [dayEntries],
  );

  const publishedAt = rosterDoc ? tsDate(rosterDoc.publishedAt) : null;

  if (authLoading || loading) return <Splash />;

  const notPublished = !rosterDoc;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Roster</h1>

      {/* This Week label */}
      <div className={styles.weekLabel}>
        <p className={styles.weekTitle}>This Week</p>
        <p className={styles.weekRange}>{fmtWeekRange(weekStart, weekEnd)}</p>
      </div>

      {notPublished ? (
        <p className={styles.emptyText}>
          The roster for this week hasn't been published yet.
        </p>
      ) : (
        <>
          {/* Next Shift hero */}
          {nextShift ? (
            <section className={styles.nextCard}>
              <div className={styles.nextHeader}>
                <div>
                  <p className={styles.nextLabel}>Next Shift</p>
                  <p className={styles.nextDate}>{fmtDayShort(nextShift.date)}</p>
                  <p className={styles.nextTime}>{fmtTime12h(nextShift.start)}</p>
                  <p className={styles.nextTimeKicker}>START</p>
                </div>
              </div>

              <div className={styles.nextDivider} />

              <p className={styles.nextShiftName}>{mealLabel(nextShift.meal)} Shift</p>

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
            {dayEntries.map((de, idx) => (
              <li key={de.iso} className={styles.weekRow}>
                <span className={styles.weekDay}>{fmtDayShort(de.date)}</span>
                {de.shifts.length === 0 ? (
                  <span className={styles.offBadge}>OFF</span>
                ) : (
                  <div className={styles.weekShift}>
                    {de.shifts.map((s, i) => (
                      <span key={i} className={styles.weekStart}>
                        {mealLabel(s.meal)} · {fmtTime12h(s.start)} Start
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
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
              <p className={styles.statValue}>{totalShifts}</p>
              <p className={styles.statLabel}>Shifts</p>
            </div>
            <div className={styles.statDivider} />
            <div className={styles.statBlock}>
              <span className={styles.statIcon} aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </span>
              <p className={styles.statValue}>{DAYS_IN_WEEK - dayEntries.filter((d) => d.shifts.length === 0).length}</p>
              <p className={styles.statLabel}>Days On</p>
            </div>
          </div>

          {/* Roster published */}
          {publishedAt && (
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
                <p className={styles.publishedDate}>
                  {publishedAt.toLocaleDateString("en-AU", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
