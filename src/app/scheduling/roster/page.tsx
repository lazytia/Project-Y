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

type RosterWeekDoc = {
  /** counts[ISO date]["lunch" | "dinner"] = number of staff rostered */
  counts?: Record<string, { lunch?: number; dinner?: number }>;
  /** notes[ISO date] = single free-text note */
  notes?: Record<string, string>;
  notesAuthor?: string;
  notesUpdatedAt?: Timestamp;
};

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

const DAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const DAY_LABELS_LONG = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

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
  const [showAvail, setShowAvail] = useState(false);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const weekStart = useMemo(() => startOfWeek(today), [today]);
  const weekStartISO = useMemo(() => isoDate(weekStart), [weekStart]);
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const load = useCallback(async () => {
    const [staffSnap, weekSnap] = await Promise.all([
      getDocs(collection(getDb(), "staff_onboarding")),
      getDocs(collection(getDb(), "rosters_published")),
    ]);
    const docs: StaffDoc[] = staffSnap.docs
      .map((d) => ({ uid: d.id, ...(d.data() as Omit<StaffDoc, "uid">) }))
      .filter((d) => d.role !== "owner");
    setStaffDocs(docs);
    const match = weekSnap.docs.find((d) => d.id === weekStartISO);
    setWeekDoc((match?.data() as RosterWeekDoc) ?? {});
  }, [weekStartISO]);

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
            const c = weekDoc.counts?.[isoDate(d)]?.lunch ?? 0;
            return (
              <div key={i} className={styles.gridCell}>
                <DotCount n={c} />
              </div>
            );
          })}
        </div>
        <div className={styles.gridRow}>
          <div className={styles.rowLabel}>
            <MoonIcon /> Dinner
          </div>
          {weekDays.map((d, i) => {
            const c = weekDoc.counts?.[isoDate(d)]?.dinner ?? 0;
            return (
              <div key={i} className={styles.gridCell}>
                <DotCount n={c} />
              </div>
            );
          })}
        </div>
      </section>

      {/* Notes */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <span className={styles.cardIcon}><NoteIcon /></span>
          <p className={styles.cardTitle}>Notes</p>
          <span className={styles.tapHint}>
            <EditIcon /> Tap to edit
          </span>
          <span className={styles.notesMeta}>
            {notesAuthor}{notesUpdatedAt ? ` · ${fmtShort(notesUpdatedAt)}` : ""}
          </span>
        </div>
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
                    onClick={() => setEditingNote(iso)}
                  >
                    {value || "Add a note…"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
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
