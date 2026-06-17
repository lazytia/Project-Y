"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, doc, getDocs, setDoc, type Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import {
  decideHolidayRequest,
  decideAvailabilityRequest,
  type Decision,
} from "@/lib/manager-actions";
import { emailToUsername } from "@/lib/username";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

/* ──────────────────────────────────────────────────────────────────────
 * Manager / owner Roster page.
 *
 * Different shape from /staff/schedule/roster (staff view):
 *  - A weekly Mon → Sun strip with a Lunch and a Dinner row showing how
 *    many staff are rostered for that meal/day (dot grid).
 *  - Notes per day (one short note from the manager, freely editable).
 *  - Inline triage of pending Holiday and Availability requests.
 *  - A collapsible per-staff availability overview.
 *
 * Shift counts come from rosters_published/{weekStartISO}.counts (set by
 * the publish flow in a follow-up). Notes live next to it in the same
 * doc. Holiday / availability come from staff_onboarding (same source as
 * the Attention Required page).
 * ──────────────────────────────────────────────────────────────────── */

type DayAvailability =
  | { kind: "available" }
  | { kind: "unavailable" }
  | { kind: "partial"; from: string; until: string };

type StoredHolidayRequest = {
  id: string;
  startDate: Timestamp;
  endDate: Timestamp;
  reason: string;
  status: "pending" | "approved" | "declined";
  createdAt?: Timestamp;
};

type StoredAvailabilityRequest = {
  id: string;
  requested: Record<string, DayAvailability>;
  reason: string | null;
  effectiveDate?: Timestamp;
  status: "pending" | "approved" | "declined";
  createdAt?: Timestamp;
};

type StaffDoc = {
  uid: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  status?: string;
  availability?: Record<string, DayAvailability>;
  holidayRequests?: StoredHolidayRequest[];
  availabilityRequests?: StoredAvailabilityRequest[];
};

type Meal = "lunch" | "dinner";

type ShiftAssignments = Record<string, string>; // staffUid → "HH:MM" start time

type RosterWeekDoc = {
  /** assignments[ISO date]["lunch" | "dinner"][uid] = "HH:MM" start time */
  assignments?: Record<string, Record<Meal, ShiftAssignments>>;
  /** counts[ISO date]["lunch" | "dinner"] = number of staff rostered (derived) */
  counts?: Record<string, { lunch?: number; dinner?: number }>;
  /** notes[ISO date] = single free-text note */
  notes?: Record<string, string>;
  notesAuthor?: string;
  notesUpdatedAt?: Timestamp;
};

const LUNCH_STARTS = ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00"];
const DINNER_STARTS = ["16:00", "16:30", "17:00", "17:30", "18:00", "18:30", "19:00"];

const STAFF_COLORS = [
  "#e91e63", "#9c27b0", "#ff7043", "#26a69a", "#42a5f5",
  "#ffb300", "#ec407a", "#26c6da", "#7e57c2", "#66bb6a",
];

function colorForUid(uid: string): string {
  let h = 0;
  for (let i = 0; i < uid.length; i += 1) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  return STAFF_COLORS[h % STAFF_COLORS.length];
}

function staffRoleLabel(role: string | undefined): string {
  if (role === "manager") return "MANAGER";
  if (role === "chef") return "CHEF";
  if (role === "owner") return "OWNER";
  return "STAFF";
}

type HolidayItem = {
  id: string;
  staffUid: string;
  staffName: string;
  startDate: Date;
  endDate: Date;
  reason: string;
};

type AvailabilityItem = {
  id: string;
  staffUid: string;
  staffName: string;
  effectiveDate: Date | null;
  reason: string;
};

type StaffAvailRow = {
  uid: string;
  name: string;
  availability: Record<string, DayAvailability>;
};

const DAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];
const DAY_LABELS_LONG = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_LABELS_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat"] as const;
const DAYS_IN_WEEK = 6;

/* ── helpers ── */

function tsDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object" && v !== null && "toDate" in (v as object)) {
    try { return (v as Timestamp).toDate(); } catch { return null; }
  }
  return null;
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  // JS getDay: 0 Sun … 6 Sat. We want Mon = 0.
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function fmtShort(d: Date): string {
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtMonDay(d: Date): string {
  return d.toLocaleDateString("en-AU", { month: "short", day: "numeric" });
}

function fmtRange(a: Date, b: Date): string {
  const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  if (sameMonth) {
    const month = a.toLocaleDateString("en-AU", { month: "short" });
    return `${month} ${a.getDate()} – ${month} ${b.getDate()}`;
  }
  return `${fmtMonDay(a)} – ${fmtMonDay(b)}`;
}

function daysInclusive(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}

function displayName(d: StaffDoc): string {
  const f = (d.firstName ?? "").trim();
  const l = (d.lastName ?? "").trim();
  if (f || l) return `${f}${f && l ? " " : ""}${l}`;
  const u = (d.username ?? "").trim();
  if (u) return u.charAt(0).toUpperCase() + u.slice(1);
  return d.uid.slice(0, 6);
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function availabilityLabel(a: DayAvailability): string {
  if (a.kind === "available") return "Available";
  if (a.kind === "unavailable") return "Unavailable";
  return `${a.from}–${a.until}`;
}

/** Render a count as a 2-column dot grid (max 8 dots). */
function DotCount({ n }: { n: number }) {
  if (n <= 0) return <span className={styles.dash} aria-hidden="true">—</span>;
  const dots = Math.min(n, 8);
  return (
    <div className={styles.dotGrid} aria-label={`${n} staff`}>
      {Array.from({ length: dots }).map((_, i) => (
        <span key={i} className={styles.dot} />
      ))}
    </div>
  );
}

export default function ManagerRosterPage() {
  const { user } = useAuth();
  const [staffDocs, setStaffDocs] = useState<StaffDoc[]>([]);
  const [weekDoc, setWeekDoc] = useState<RosterWeekDoc>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [editingNoteNext, setEditingNoteNext] = useState<string | null>(null);
  const [showNotes, setShowNotes] = useState(true);
  const [showNotesNext, setShowNotesNext] = useState(true);
  const [showAvail, setShowAvail] = useState(false);
  const [showPrevWeek, setShowPrevWeek] = useState(false);
  const [nextWeekDoc, setNextWeekDoc] = useState<RosterWeekDoc>({});
  const [prevWeekDoc, setPrevWeekDoc] = useState<RosterWeekDoc>({});
  const [modalCell, setModalCell] = useState<{ iso: string; meal: Meal; weekKey: string } | null>(null);
  const [pendingStart, setPendingStart] = useState<string>("");
  const [savingShift, setSavingShift] = useState(false);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const weekStart = useMemo(() => startOfWeek(today), [today]);
  const weekStartISO = useMemo(() => isoDate(weekStart), [weekStart]);
  const weekEnd = useMemo(() => addDays(weekStart, DAYS_IN_WEEK - 1), [weekStart]);
  const weekDays = useMemo(
    () => Array.from({ length: DAYS_IN_WEEK }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const nextWeekStart = useMemo(() => addDays(weekStart, 7), [weekStart]);
  const nextWeekStartISO = useMemo(() => isoDate(nextWeekStart), [nextWeekStart]);
  const nextWeekEnd = useMemo(() => addDays(nextWeekStart, DAYS_IN_WEEK - 1), [nextWeekStart]);
  const nextWeekDays = useMemo(
    () => Array.from({ length: DAYS_IN_WEEK }, (_, i) => addDays(nextWeekStart, i)),
    [nextWeekStart],
  );

  const prevWeekStart = useMemo(() => addDays(weekStart, -7), [weekStart]);
  const prevWeekStartISO = useMemo(() => isoDate(prevWeekStart), [prevWeekStart]);
  const prevWeekEnd = useMemo(() => addDays(prevWeekStart, DAYS_IN_WEEK - 1), [prevWeekStart]);
  const prevWeekDays = useMemo(
    () => Array.from({ length: DAYS_IN_WEEK }, (_, i) => addDays(prevWeekStart, i)),
    [prevWeekStart],
  );

  const load = useCallback(async () => {
    // Load each collection independently so a missing-permission error
    // on one doesn't blank the whole page.
    try {
      const staffSnap = await getDocs(collection(getDb(), "staff_onboarding"));
      const docs: StaffDoc[] = staffSnap.docs
        .map((d) => ({ uid: d.id, ...(d.data() as Omit<StaffDoc, "uid">) }))
        .filter((d) => d.role !== "owner");
      setStaffDocs(docs);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[roster] staff load failed", err);
    }
    try {
      const weekSnap = await getDocs(collection(getDb(), "rosters_published"));
      const match = weekSnap.docs.find((d) => d.id === weekStartISO);
      setWeekDoc((match?.data() as RosterWeekDoc) ?? {});
      const matchNext = weekSnap.docs.find((d) => d.id === nextWeekStartISO);
      setNextWeekDoc((matchNext?.data() as RosterWeekDoc) ?? {});
      const matchPrev = weekSnap.docs.find((d) => d.id === prevWeekStartISO);
      setPrevWeekDoc((matchPrev?.data() as RosterWeekDoc) ?? {});
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[roster] week doc load failed", err);
      setWeekDoc({});
      setNextWeekDoc({});
      setPrevWeekDoc({});
    }
  }, [weekStartISO, nextWeekStartISO, prevWeekStartISO]);

  useEffect(() => {
    (async () => {
      try { await load(); } finally { setLoading(false); }
    })();
  }, [load]);

  const holidayItems: HolidayItem[] = useMemo(() => {
    const out: HolidayItem[] = [];
    for (const d of staffDocs) {
      for (const r of d.holidayRequests ?? []) {
        if (r.status !== "pending") continue;
        const s = tsDate(r.startDate);
        const e = tsDate(r.endDate);
        if (!s || !e) continue;
        out.push({
          id: r.id,
          staffUid: d.uid,
          staffName: displayName(d),
          startDate: s,
          endDate: e,
          reason: r.reason ?? "",
        });
      }
    }
    return out.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  }, [staffDocs]);

  const availabilityItems: AvailabilityItem[] = useMemo(() => {
    const out: AvailabilityItem[] = [];
    for (const d of staffDocs) {
      for (const r of d.availabilityRequests ?? []) {
        if (r.status !== "pending") continue;
        out.push({
          id: r.id,
          staffUid: d.uid,
          staffName: displayName(d),
          effectiveDate: tsDate(r.effectiveDate),
          reason: r.reason ?? "",
        });
      }
    }
    return out.sort(
      (a, b) => (a.effectiveDate?.getTime() ?? 0) - (b.effectiveDate?.getTime() ?? 0),
    );
  }, [staffDocs]);

  const staffAvailRows: StaffAvailRow[] = useMemo(() => {
    return staffDocs
      .filter((d) => d.role !== "owner")
      .map((d) => ({
        uid: d.uid,
        name: displayName(d),
        availability: (d.availability ?? {}) as Record<string, DayAvailability>,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [staffDocs]);

  async function decide(
    kind: "holiday" | "availability",
    staffUid: string,
    requestId: string,
    decision: Decision,
  ) {
    if (!user) return;
    setBusy(requestId);
    try {
      if (kind === "holiday") {
        await decideHolidayRequest(staffUid, user.uid, requestId, decision);
      } else {
        await decideAvailabilityRequest(staffUid, user.uid, requestId, decision);
      }
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed.");
    } finally {
      setBusy(null);
    }
  }

  async function saveAssignments(
    weekKey: string,
    iso: string,
    meal: Meal,
    next: ShiftAssignments,
  ) {
    const isNext = weekKey === nextWeekStartISO;
    const currentDoc = isNext ? nextWeekDoc : weekDoc;
    const setCurrentDoc = isNext ? setNextWeekDoc : setWeekDoc;

    setSavingShift(true);
    try {
      const allAssignments = { ...(currentDoc.assignments ?? {}) };
      const dayAssignments = { ...(allAssignments[iso] ?? { lunch: {}, dinner: {} }) };
      dayAssignments[meal] = next;
      allAssignments[iso] = dayAssignments;

      const counts = { ...(currentDoc.counts ?? {}) };
      counts[iso] = {
        ...(counts[iso] ?? {}),
        lunch: Object.keys(dayAssignments.lunch ?? {}).length,
        dinner: Object.keys(dayAssignments.dinner ?? {}).length,
      };

      await setDoc(
        doc(getDb(), "rosters_published", weekKey),
        { assignments: allAssignments, counts },
        { merge: true },
      );
      setCurrentDoc((prev) => ({ ...prev, assignments: allAssignments, counts }));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save shift.");
    } finally {
      setSavingShift(false);
    }
  }

  function assignedFor(iso: string, meal: Meal, weekKey: string): ShiftAssignments {
    const d = weekKey === nextWeekStartISO ? nextWeekDoc : weekDoc;
    return d.assignments?.[iso]?.[meal] ?? {};
  }

  async function assignStaff(uid: string, startTime: string) {
    if (!modalCell) return;
    const cur = assignedFor(modalCell.iso, modalCell.meal, modalCell.weekKey);
    if (cur[uid] === startTime) return;
    await saveAssignments(modalCell.weekKey, modalCell.iso, modalCell.meal, { ...cur, [uid]: startTime });
  }

  async function removeStaff(uid: string) {
    if (!modalCell) return;
    const cur = assignedFor(modalCell.iso, modalCell.meal, modalCell.weekKey);
    if (!(uid in cur)) return;
    const next = { ...cur };
    delete next[uid];
    await saveAssignments(modalCell.weekKey, modalCell.iso, modalCell.meal, next);
  }

  async function saveNextNote(iso: string, text: string) {
    if (!user) return;
    const trimmed = text.trim();
    const nextNotes = { ...(nextWeekDoc.notes ?? {}) };
    if (trimmed) nextNotes[iso] = trimmed;
    else delete nextNotes[iso];

    const authorName =
      emailToUsername(user.email ?? "").charAt(0).toUpperCase() +
      emailToUsername(user.email ?? "").slice(1);

    try {
      await setDoc(
        doc(getDb(), "rosters_published", nextWeekStartISO),
        { notes: nextNotes, notesAuthor: authorName, notesUpdatedAt: new Date() },
        { merge: true },
      );
      setNextWeekDoc((prev) => ({ ...prev, notes: nextNotes, notesAuthor: authorName }));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save note.");
    } finally {
      setEditingNoteNext(null);
    }
  }

  async function saveNote(iso: string, text: string) {
    if (!user) return;
    const trimmed = text.trim();
    const nextNotes = { ...(weekDoc.notes ?? {}) };
    if (trimmed) nextNotes[iso] = trimmed;
    else delete nextNotes[iso];

    const authorName =
      emailToUsername(user.email ?? "").charAt(0).toUpperCase() +
      emailToUsername(user.email ?? "").slice(1);

    try {
      await setDoc(
        doc(getDb(), "rosters_published", weekStartISO),
        {
          notes: nextNotes,
          notesAuthor: authorName,
          notesUpdatedAt: new Date(),
        },
        { merge: true },
      );
      setWeekDoc((prev) => ({
        ...prev,
        notes: nextNotes,
        notesAuthor: authorName,
      }));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save note.");
    } finally {
      setEditingNote(null);
    }
  }

  if (loading) return <Splash />;

  const notesAuthor = weekDoc.notesAuthor ?? "";
  const notesUpdatedAt = tsDate(weekDoc.notesUpdatedAt);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Roster</h1>
        <p className={styles.subtitle}>{fmtRange(weekStart, weekEnd)}</p>
      </header>

      {/* Week strip with Lunch / Dinner rows */}
      <section className={styles.grid}>
        <div className={styles.gridHeadRow}>
          <span />
          {weekDays.map((d, i) => {
            const isToday = isSameDay(d, today);
            return (
              <div key={i} className={styles.gridHeadCol}>
                <span className={styles.dowLabel}>{DAY_LABELS[i]}</span>
                <span className={`${styles.dayNum} ${isToday ? styles.dayNumToday : ""}`}>
                  {d.getDate()}
                </span>
              </div>
            );
          })}
        </div>
        <div className={styles.gridRow}>
          <div className={styles.rowLabel}>
            <SunIcon /> Lunch
          </div>
          {weekDays.map((d, i) => {
            const iso = isoDate(d);
            const n = Object.keys(weekDoc.assignments?.[iso]?.lunch ?? {}).length;
            return (
              <button
                key={i}
                type="button"
                className={styles.gridCell}
                onClick={() => {
                  setPendingStart(LUNCH_STARTS[2]);
                  setModalCell({ iso, meal: "lunch", weekKey: weekStartISO });
                }}
              >
                <DotCount n={n} />
              </button>
            );
          })}
        </div>
        <div className={styles.gridRow}>
          <div className={styles.rowLabel}>
            <MoonIcon /> Dinner
          </div>
          {weekDays.map((d, i) => {
            const iso = isoDate(d);
            const n = Object.keys(weekDoc.assignments?.[iso]?.dinner ?? {}).length;
            return (
              <button
                key={i}
                type="button"
                className={styles.gridCell}
                onClick={() => {
                  setPendingStart(DINNER_STARTS[2]);
                  setModalCell({ iso, meal: "dinner", weekKey: weekStartISO });
                }}
              >
                <DotCount n={n} />
              </button>
            );
          })}
        </div>
      </section>

      {/* Notes */}
      <section className={styles.card}>
        <button
          type="button"
          className={styles.cardHeadBtn}
          onClick={() => setShowNotes((s) => !s)}
          aria-expanded={showNotes}
        >
          <span className={styles.cardIcon}><NoteIcon /></span>
          <p className={styles.cardTitle}>Notes</p>
          <span className={styles.notesMeta}>
            {notesAuthor}{notesUpdatedAt ? ` · ${fmtShort(notesUpdatedAt)}` : ""}
          </span>
          <span className={`${styles.chev} ${showNotes ? styles.chevOpen : ""}`}>▾</span>
        </button>
        {showNotes && (
          <ul className={styles.notesList}>
            {weekDays.map((d, i) => {
              const iso = isoDate(d);
              const isToday = isSameDay(d, today);
              const value = weekDoc.notes?.[iso] ?? "";
              const editing = editingNote === iso;
              return (
                <li key={iso} className={styles.noteRow}>
                  <div className={styles.noteDayCol}>
                    <span className={`${styles.noteDay} ${isToday ? styles.noteDayToday : ""}`}>
                      {DAY_LABELS_LONG[i]}
                    </span>
                    <span className={`${styles.noteDate} ${isToday ? styles.noteDateToday : ""}`}>
                      {fmtMonDay(d)}
                    </span>
                  </div>
                  {editing ? (
                    <input
                      autoFocus
                      type="text"
                      className={styles.noteInput}
                      defaultValue={value}
                      placeholder="Add a note…"
                      onBlur={(e) => saveNote(iso, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") setEditingNote(null);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className={`${styles.noteBtn} ${value ? "" : styles.notePlaceholder}`}
                      onClick={(e) => { e.stopPropagation(); setEditingNote(iso); }}
                    >
                      {value || "Add a note…"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Next Week Roster */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <span className={styles.cardIcon}><CalIcon /></span>
          <p className={styles.cardTitle}>Next Week</p>
          <p className={styles.cardSubtitle}>{fmtRange(nextWeekStart, nextWeekEnd)}</p>
        </div>
        <div className={styles.cardGrid}>
          <div className={styles.gridHeadRow}>
            <span />
            {nextWeekDays.map((d, i) => (
              <div key={i} className={styles.gridHeadCol}>
                <span className={styles.dowLabel}>{DAY_LABELS[i]}</span>
                <span className={styles.dayNum}>{d.getDate()}</span>
              </div>
            ))}
          </div>
          <div className={styles.gridRow}>
            <div className={styles.rowLabel}><SunIcon /> Lunch</div>
            {nextWeekDays.map((d, i) => {
              const iso = isoDate(d);
              const n = Object.keys(nextWeekDoc.assignments?.[iso]?.lunch ?? {}).length;
              return (
                <button
                  key={i}
                  type="button"
                  className={styles.gridCell}
                  onClick={() => {
                    setPendingStart(LUNCH_STARTS[2]);
                    setModalCell({ iso, meal: "lunch", weekKey: nextWeekStartISO });
                  }}
                >
                  <DotCount n={n} />
                </button>
              );
            })}
          </div>
          <div className={styles.gridRow}>
            <div className={styles.rowLabel}><MoonIcon /> Dinner</div>
            {nextWeekDays.map((d, i) => {
              const iso = isoDate(d);
              const n = Object.keys(nextWeekDoc.assignments?.[iso]?.dinner ?? {}).length;
              return (
                <button
                  key={i}
                  type="button"
                  className={styles.gridCell}
                  onClick={() => {
                    setPendingStart(DINNER_STARTS[2]);
                    setModalCell({ iso, meal: "dinner", weekKey: nextWeekStartISO });
                  }}
                >
                  <DotCount n={n} />
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Next Week Notes */}
      <section className={styles.card}>
        <button
          type="button"
          className={styles.cardHeadBtn}
          onClick={() => setShowNotesNext((s) => !s)}
          aria-expanded={showNotesNext}
        >
          <span className={styles.cardIcon}><NoteIcon /></span>
          <p className={styles.cardTitle}>Notes</p>
          <span className={styles.notesMeta}>
            {nextWeekDoc.notesAuthor ?? ""}
            {(() => { const d = tsDate(nextWeekDoc.notesUpdatedAt); return d ? ` · ${fmtShort(d)}` : ""; })()}
          </span>
          <span className={`${styles.chev} ${showNotesNext ? styles.chevOpen : ""}`}>▾</span>
        </button>
        {showNotesNext && (
          <ul className={styles.notesList}>
            {nextWeekDays.map((d, i) => {
              const iso = isoDate(d);
              const value = nextWeekDoc.notes?.[iso] ?? "";
              const editing = editingNoteNext === iso;
              return (
                <li key={iso} className={styles.noteRow}>
                  <div className={styles.noteDayCol}>
                    <span className={styles.noteDay}>{DAY_LABELS_LONG[i]}</span>
                    <span className={styles.noteDate}>{fmtMonDay(d)}</span>
                  </div>
                  {editing ? (
                    <input
                      autoFocus
                      type="text"
                      className={styles.noteInput}
                      defaultValue={value}
                      placeholder="Add a note…"
                      onBlur={(e) => saveNextNote(iso, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") setEditingNoteNext(null);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className={`${styles.noteBtn} ${value ? "" : styles.notePlaceholder}`}
                      onClick={() => setEditingNoteNext(iso)}
                    >
                      {value || "Add a note…"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Previous Week (accordion) */}
      <section className={styles.card}>
        <button
          type="button"
          className={styles.cardHeadBtn}
          onClick={() => setShowPrevWeek((s) => !s)}
          aria-expanded={showPrevWeek}
        >
          <span className={styles.cardIcon}><CalIcon /></span>
          <p className={styles.cardTitle}>Previous Week</p>
          <p className={styles.cardSubtitle}>{fmtRange(prevWeekStart, prevWeekEnd)}</p>
          <span className={styles.tapToExpand}>
            {showPrevWeek ? "Collapse" : "Expand"}
            <span className={`${styles.chev} ${showPrevWeek ? styles.chevOpen : ""}`}>▾</span>
          </span>
        </button>
        {showPrevWeek && (
          <div>
            <div className={styles.cardGrid}>
              <div className={styles.gridHeadRow}>
                <span />
                {prevWeekDays.map((d, i) => (
                  <div key={i} className={styles.gridHeadCol}>
                    <span className={styles.dowLabel}>{DAY_LABELS[i]}</span>
                    <span className={styles.dayNum}>{d.getDate()}</span>
                  </div>
                ))}
              </div>
              <div className={styles.gridRow}>
                <div className={styles.rowLabel}><SunIcon /> Lunch</div>
                {prevWeekDays.map((d, i) => {
                  const iso = isoDate(d);
                  const n = Object.keys(prevWeekDoc.assignments?.[iso]?.lunch ?? {}).length;
                  return (
                    <div key={i} className={styles.gridCellReadOnly}>
                      <DotCount n={n} />
                    </div>
                  );
                })}
              </div>
              <div className={styles.gridRow}>
                <div className={styles.rowLabel}><MoonIcon /> Dinner</div>
                {prevWeekDays.map((d, i) => {
                  const iso = isoDate(d);
                  const n = Object.keys(prevWeekDoc.assignments?.[iso]?.dinner ?? {}).length;
                  return (
                    <div key={i} className={styles.gridCellReadOnly}>
                      <DotCount n={n} />
                    </div>
                  );
                })}
              </div>
            </div>
            <div className={styles.cardSubHead}>
              <span className={styles.cardIcon}><NoteIcon /></span>
              <p className={styles.cardTitle}>Notes</p>
              {prevWeekDoc.notesAuthor && (
                <span className={styles.notesMeta}>{prevWeekDoc.notesAuthor}</span>
              )}
            </div>
            <ul className={styles.notesList}>
              {prevWeekDays.map((d, i) => {
                const iso = isoDate(d);
                const value = prevWeekDoc.notes?.[iso] ?? "";
                return (
                  <li key={iso} className={styles.noteRow}>
                    <div className={styles.noteDayCol}>
                      <span className={styles.noteDay}>{DAY_LABELS_LONG[i]}</span>
                      <span className={styles.noteDate}>{fmtMonDay(d)}</span>
                    </div>
                    <span className={styles.noteReadOnly}>{value}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      {/* Holiday Requests */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <span className={styles.cardIcon}><CalIcon /></span>
          <p className={styles.cardTitle}>Holiday Requests</p>
          <span className={styles.countPill}>{holidayItems.length}</span>
          <a href="/attention-required?filter=holiday" className={styles.viewAll}>
            View all requests <ArrowRight />
          </a>
        </div>
        {holidayItems.length === 0 ? (
          <p className={styles.empty}>No pending requests.</p>
        ) : (
          <ul className={styles.reqList}>
            {holidayItems.slice(0, 3).map((h) => (
              <li key={h.id} className={styles.reqRow}>
                <span className={styles.reqDot} aria-hidden="true" />
                <div className={styles.reqBody}>
                  <p className={styles.reqTitle}>
                    {h.reason || "Annual Leave"}{" "}
                    <span className={styles.reqMeta}>
                      · {fmtRange(h.startDate, h.endDate)} ({daysInclusive(h.startDate, h.endDate)}{" "}
                      {daysInclusive(h.startDate, h.endDate) === 1 ? "day" : "days"})
                    </span>
                  </p>
                  <p className={styles.reqStaff}>{h.staffName}</p>
                </div>
                <div className={styles.reqActions}>
                  <button
                    type="button"
                    className={styles.btnApproveSm}
                    disabled={busy === h.id}
                    onClick={() => decide("holiday", h.staffUid, h.id, "approved")}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className={styles.btnDeclineSm}
                    disabled={busy === h.id}
                    onClick={() => decide("holiday", h.staffUid, h.id, "declined")}
                  >
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Availability Change Requests */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <span className={styles.cardIcon}><CalIcon /></span>
          <p className={styles.cardTitle}>Availability Change Requests</p>
          <span className={styles.countPill}>{availabilityItems.length}</span>
          <a href="/attention-required?filter=availability" className={styles.viewAll}>
            View all requests <ArrowRight />
          </a>
        </div>
        {availabilityItems.length === 0 ? (
          <p className={styles.empty}>No pending requests.</p>
        ) : (
          <ul className={styles.reqList}>
            {availabilityItems.slice(0, 3).map((r) => (
              <li key={r.id} className={styles.reqRow}>
                <span className={styles.reqDot} aria-hidden="true" />
                <div className={styles.reqBody}>
                  <p className={styles.reqTitle}>
                    Change effective{" "}
                    <span className={styles.reqMeta}>
                      · {r.effectiveDate ? fmtShort(r.effectiveDate) : "—"}
                    </span>
                  </p>
                  <p className={styles.reqStaff}>{r.staffName}</p>
                </div>
                <div className={styles.reqActions}>
                  <button
                    type="button"
                    className={styles.btnApproveSm}
                    disabled={busy === r.id}
                    onClick={() => decide("availability", r.staffUid, r.id, "approved")}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className={styles.btnDeclineSm}
                    disabled={busy === r.id}
                    onClick={() => decide("availability", r.staffUid, r.id, "declined")}
                  >
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Day-meal assignment modal */}
      {modalCell && (() => {
        const cellDate = (() => {
          const [y, m, d] = modalCell.iso.split("-").map(Number);
          return new Date(y, m - 1, d);
        })();
        const dowIdx = (cellDate.getDay() + 6) % 7;
        const longDow = DAY_LABELS_FULL[dowIdx] ?? DAY_LABELS_LONG[dowIdx];
        const cur = assignedFor(modalCell.iso, modalCell.meal, modalCell.weekKey);
        const assignedCount = Object.keys(cur).length;
        const starts = modalCell.meal === "lunch" ? LUNCH_STARTS : DINNER_STARTS;
        return (
          <div
            className={styles.modalBackdrop}
            role="dialog"
            aria-modal="true"
            aria-label="Assign shift"
            onClick={() => setModalCell(null)}
          >
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
              <header className={styles.modalHead}>
                <div className={styles.modalTitleWrap}>
                  <h2 className={styles.modalTitle}>
                    {longDow}, {fmtMonDay(cellDate)}
                  </h2>
                  <p className={styles.modalSub}>
                    {modalCell.meal === "lunch" ? "Lunch" : "Dinner"}
                  </p>
                </div>
                <span className={styles.modalCount}>{assignedCount} assigned</span>
                <button
                  type="button"
                  className={styles.modalClose}
                  onClick={() => setModalCell(null)}
                  aria-label="Close"
                >
                  ×
                </button>
              </header>

              <section className={styles.modalSection}>
                <p className={styles.modalSectionLabel}>START TIME</p>
                <div className={styles.timePills}>
                  {starts.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`${styles.timePill} ${pendingStart === t ? styles.timePillActive : ""}`}
                      onClick={() => setPendingStart(t)}
                    >
                      {t} Start
                    </button>
                  ))}
                </div>
              </section>

              <section className={styles.modalSection}>
                <p className={styles.modalSectionLabel}>TEMPORARY STAFF</p>
                <div className={styles.tempRow}>
                  <button
                    type="button"
                    className={`${styles.tempPill} ${styles.tempPillKitchen}`}
                    onClick={() => assignStaff(`tr_kitchen_${Date.now()}`, pendingStart)}
                  >
                    + TR Kitchen Staff
                  </button>
                  <button
                    type="button"
                    className={`${styles.tempPill} ${styles.tempPillHall}`}
                    onClick={() => assignStaff(`tr_hall_${Date.now()}`, pendingStart)}
                  >
                    + TR Hall Staff
                  </button>
                </div>
              </section>

              <ul className={styles.staffList}>
                {(() => {
                  // Build a warning map: uid → reason string (holiday / unavailable)
                  const cellDayKey = DAY_KEYS[dowIdx] as string | undefined;
                  const warningMap = new Map<string, string>();
                  for (const d of staffDocs) {
                    // 1. Approved holiday covering this date
                    for (const r of d.holidayRequests ?? []) {
                      if (r.status !== "approved") continue;
                      const s = tsDate(r.startDate);
                      const e = tsDate(r.endDate);
                      if (s && e) {
                        const sDay = new Date(s); sDay.setHours(0, 0, 0, 0);
                        const eDay = new Date(e); eDay.setHours(23, 59, 59, 999);
                        if (cellDate >= sDay && cellDate <= eDay) {
                          warningMap.set(d.uid, "On holiday");
                          break;
                        }
                      }
                    }
                    if (warningMap.has(d.uid) || !cellDayKey) continue;
                    // 2. Current availability says unavailable for this weekday
                    // Check base availability, then override with latest approved change
                    let avail = d.availability?.[cellDayKey] as DayAvailability | undefined;
                    const approvedChanges = (d.availabilityRequests ?? [])
                      .filter((r) => r.status === "approved" && r.requested?.[cellDayKey]);
                    if (approvedChanges.length > 0) {
                      // Latest approved change wins
                      avail = approvedChanges[approvedChanges.length - 1].requested?.[cellDayKey];
                    }
                    if (avail?.kind === "unavailable") {
                      warningMap.set(d.uid, "Unavailable this day");
                    }
                  }

                  const real = staffDocs
                    .map((d) => ({
                      uid: d.uid,
                      name: displayName(d),
                      role: staffRoleLabel(d.role),
                      isTemp: false,
                      warning: warningMap.get(d.uid) ?? null,
                    }))
                    .sort((a, b) => a.name.localeCompare(b.name));
                  const temp = Object.keys(cur)
                    .filter((u) => u.startsWith("tr_"))
                    .map((u) => ({
                      uid: u,
                      name: u.startsWith("tr_kitchen_") ? "TR Kitchen Staff" : "TR Hall Staff",
                      role: "TR",
                      isTemp: true,
                      warning: null as string | null,
                    }));
                  return [...real, ...temp];
                })().map((s) => {
                  const assigned = cur[s.uid];
                  return (
                    <li key={s.uid} className={`${styles.staffRow} ${s.warning ? styles.staffRowWarn : ""}`}>
                      <span className={styles.staffDot} style={{ background: colorForUid(s.uid) }} />
                      <span className={styles.staffName}>
                        {s.name}
                        {s.warning && (
                          <span className={styles.warnBadge} title={s.warning} aria-label={s.warning}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M12 2L1 21h22L12 2zm0 3.5L20.5 19h-17L12 5.5zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z"/>
                            </svg>
                          </span>
                        )}
                      </span>
                      <span className={styles.staffRole}>{s.role}</span>
                      <button
                        type="button"
                        className={`${styles.staffStartBtn} ${assigned ? styles.staffStartBtnAssigned : ""}`}
                        disabled={savingShift}
                        onClick={() => assignStaff(s.uid, pendingStart)}
                      >
                        {assigned ? `${assigned} Start` : `+ ${pendingStart} Start`}
                      </button>
                      {(s.isTemp || assigned) && (
                        <button
                          type="button"
                          className={styles.staffRemoveBtn}
                          disabled={savingShift}
                          onClick={() => removeStaff(s.uid)}
                          aria-label="Remove"
                        >
                          ×
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>

              <footer className={styles.modalFoot}>
                <button
                  type="button"
                  className={styles.modalDoneBtn}
                  onClick={() => setModalCell(null)}
                >
                  Done
                </button>
              </footer>
            </div>
          </div>
        );
      })()}

      {/* Availability Overview (collapsible) */}
      <section className={styles.card}>
        <button
          type="button"
          className={styles.cardHeadBtn}
          onClick={() => setShowAvail((s) => !s)}
          aria-expanded={showAvail}
        >
          <span className={styles.cardIcon}><PeopleIcon /></span>
          <p className={styles.cardTitle}>Availability Overview</p>
          <span className={styles.tapToExpand}>
            {showAvail ? "Tap to collapse" : "Tap to expand"}
            <span className={`${styles.chev} ${showAvail ? styles.chevOpen : ""}`}>▾</span>
          </span>
        </button>
        {showAvail && (
          staffAvailRows.length === 0 ? (
            <p className={styles.empty}>No staff registered yet.</p>
          ) : (
            <ul className={styles.availList}>
              {staffAvailRows.map((s) => (
                <li key={s.uid} className={styles.availRow}>
                  <p className={styles.availName}>{s.name}</p>
                  <div className={styles.availDays}>
                    {DAY_KEYS.map((k, i) => {
                      const a = s.availability[k] ?? { kind: "available" as const };
                      return (
                        <div key={k} className={styles.availCell}>
                          <span className={styles.availDayLabel}>{DAY_LABELS_LONG[i]}</span>
                          <span
                            className={`${styles.availPill} ${
                              a.kind === "unavailable"
                                ? styles.availPillNo
                                : a.kind === "partial"
                                  ? styles.availPillPartial
                                  : styles.availPillYes
                            }`}
                          >
                            {availabilityLabel(a)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          )
        )}
      </section>
    </div>
  );
}

/* ── small icons ── */

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
      <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
      <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
function NoteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}
function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}
function CalIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}
function PeopleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function ArrowRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}
