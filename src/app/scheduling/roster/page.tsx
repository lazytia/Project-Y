"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, doc, getDocs, setDoc, type Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import {
  decideHolidayRequest,
  decideAvailabilityRequest,
  publishStaffRoster,
  type Decision,
  type PublishShift,
} from "@/lib/manager-actions";
import { isChef } from "@/lib/permissions";
import { emailToUsername } from "@/lib/username";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

/* ──────────────────────────────────────────────────────────────────────
 * Manager / owner Roster page.
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
type RosterViewWeekKey = "current" | "next" | "prev";

/** A single note entry stored in rosters_published notes[iso][]. */
type NoteEntry = {
  id: string;
  authorUid: string;
  authorName: string;
  authorRole: "manager" | "chef";
  text: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createdAt?: any; // Firestore Timestamp or Date
};

type RosterWeekDoc = {
  /** assignments[ISO date]["lunch" | "dinner"][uid] = "HH:MM" start time */
  assignments?: Record<string, Record<Meal, ShiftAssignments>>;
  /** counts[ISO date]["lunch" | "dinner"] = number of staff rostered */
  counts?: Record<string, { lunch?: number; dinner?: number }>;
  /** notes[ISO date] = NoteEntry[] (new) or legacy string */
  notes?: Record<string, unknown>;
  /** legacy fields kept for backward compat */
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
const SYDNEY_TZ = "Australia/Sydney";
const TIME_PATTERN = /^([01]?\d|2[0-3]):[0-5]\d$/;

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

function sydneyTodayDate(): Date {
  const key = new Date().toLocaleDateString("en-CA", { timeZone: SYDNEY_TZ });
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function assignmentCount(doc: RosterWeekDoc, iso: string, meal: Meal): number {
  const assignments = doc.assignments?.[iso]?.[meal] ?? {};
  const fromAssignments = Object.keys(assignments).length;
  if (fromAssignments > 0) return fromAssignments;
  return doc.counts?.[iso]?.[meal] ?? 0;
}

function resolveShiftStaff(
  key: string,
  value: string,
  staffDocs: StaffDoc[],
): { name: string; startTime: string | null } {
  if (key.startsWith("tr_kitchen_")) {
    return {
      name: "TR Kitchen Staff",
      startTime: TIME_PATTERN.test(value) ? value : null,
    };
  }
  if (key.startsWith("tr_hall_")) {
    return {
      name: "TR Hall Staff",
      startTime: TIME_PATTERN.test(value) ? value : null,
    };
  }

  const byUid = staffDocs.find((d) => d.uid === key);
  if (byUid) {
    return {
      name: displayName(byUid),
      startTime: TIME_PATTERN.test(value) ? value : null,
    };
  }

  if (TIME_PATTERN.test(value)) {
    const byName = staffDocs.find(
      (d) => displayName(d).toLowerCase() === key.trim().toLowerCase(),
    );
    return {
      name: byName ? displayName(byName) : key,
      startTime: value,
    };
  }

  const legacyName = value.trim() || key.trim();
  const byLegacyName = staffDocs.find(
    (d) => displayName(d).toLowerCase() === legacyName.toLowerCase(),
  );
  return {
    name: byLegacyName ? displayName(byLegacyName) : legacyName,
    startTime: null,
  };
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

/** Convert a Firestore notes[iso] value (new array or legacy string) to NoteEntry[]. */
function normalizeNotes(raw: unknown): NoteEntry[] {
  if (!raw) return [];
  if (typeof raw === "string") {
    if (!raw.trim()) return [];
    return [{
      id: "legacy",
      authorUid: "",
      authorName: "Manager",
      authorRole: "manager",
      text: raw,
    }];
  }
  if (Array.isArray(raw)) return raw as NoteEntry[];
  return [];
}

function roleDisplayLabel(role: "manager" | "chef"): string {
  return role === "chef" ? "Head Chef" : "Manager";
}

/** Format a Date as "9:15 AM" */
function fmtTime(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${m} ${suffix}`;
}

/** Format a Date as "Wednesday, 1 Jul" for the notes modal header. */
function fmtNoteDate(d: Date): string {
  const dow = d.toLocaleDateString("en-AU", { weekday: "long" });
  const day = d.getDate();
  const month = d.toLocaleDateString("en-AU", { month: "short" });
  return `${dow}, ${day} ${month}`;
}

type NoteEntriesListProps = {
  notes: NoteEntry[];
  userUid: string | undefined;
  weekKey: RosterViewWeekKey;
  isChefViewer: boolean;
  noteEditingId: string | null;
  noteEditingDraft: string;
  setNoteEditingId: (id: string | null) => void;
  setNoteEditingDraft: (draft: string) => void;
  noteOptionsId: string | null;
  setNoteOptionsId: (id: string | null) => void;
  savingNote: boolean;
  onUpdate: (noteId: string) => void;
  onDelete: (noteId: string) => void;
};

function NoteEntriesList({
  notes,
  userUid,
  weekKey,
  isChefViewer,
  noteEditingId,
  noteEditingDraft,
  setNoteEditingId,
  setNoteEditingDraft,
  noteOptionsId,
  setNoteOptionsId,
  savingNote,
  onUpdate,
  onDelete,
}: NoteEntriesListProps) {
  if (notes.length === 0) return null;

  return (
    <>
      {notes.map((note) => {
        const createdDate = tsDate(note.createdAt);
        return (
          <div key={note.id} className={styles.noteEntryBlock}>
            <div className={styles.noteEntryCardHead}>
              <span className={styles.noteEntryAuthor}>
                {note.authorName} ({roleDisplayLabel(note.authorRole)})
              </span>
              {createdDate && (
                <span className={styles.noteEntryTime}>{fmtTime(createdDate)}</span>
              )}
            </div>
            {noteEditingId === note.id ? (
              <div>
                <textarea
                  autoFocus
                  className={styles.noteEditTextarea}
                  value={noteEditingDraft}
                  maxLength={500}
                  onChange={(e) => setNoteEditingDraft(e.target.value)}
                  rows={3}
                />
                <div className={styles.noteEditActions}>
                  <button
                    type="button"
                    className={styles.noteEditCancelBtn}
                    onClick={() => {
                      setNoteEditingId(null);
                      setNoteEditingDraft("");
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={styles.noteEditSaveBtn}
                    disabled={savingNote || !noteEditingDraft.trim()}
                    onClick={() => onUpdate(note.id)}
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <div className={styles.noteEntryCardBody}>
                <p className={styles.noteEntryText}>{note.text}</p>
                {userUid === note.authorUid
                  && weekKey !== "prev"
                  && (!isChefViewer || note.authorRole === "chef") && (
                  <div
                    className={styles.noteOptionsWrap}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className={styles.noteOptionsBtn}
                      aria-label="Note options"
                      onClick={() =>
                        setNoteOptionsId(noteOptionsId === note.id ? null : note.id)
                      }
                    >
                      ...
                    </button>
                    {noteOptionsId === note.id && (
                      <div className={styles.noteOptionsMenu}>
                        <button
                          type="button"
                          className={styles.noteOptionsItem}
                          onClick={() => {
                            setNoteEditingId(note.id);
                            setNoteEditingDraft(note.text);
                            setNoteOptionsId(null);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className={`${styles.noteOptionsItem} ${styles.noteOptionsItemDelete}`}
                          disabled={savingNote}
                          onClick={() => onDelete(note.id)}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
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
  const isChefUser = isChef(user);
  const [staffDocs, setStaffDocs] = useState<StaffDoc[]>([]);
  const [weekDoc, setWeekDoc] = useState<RosterWeekDoc>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAvail, setShowAvail] = useState(false);
  const [showPrevWeek, setShowPrevWeek] = useState(false);
  const [nextWeekDoc, setNextWeekDoc] = useState<RosterWeekDoc>({});
  const [prevWeekDoc, setPrevWeekDoc] = useState<RosterWeekDoc>({});
  const [modalCell, setModalCell] = useState<{ iso: string; meal: Meal; weekKey: string } | null>(null);
  const [warnSectionOpen, setWarnSectionOpen] = useState(true);
  const [confirmAssign, setConfirmAssign] = useState<{
    uid: string; name: string; startTime: string;
    warnType: "holiday" | "unavailability"; cellDate: Date;
  } | null>(null);

  /* ── Notes modal state ── */
  const [noteModal, setNoteModal] = useState<{
    label: string; iso: string; weekKey: RosterViewWeekKey;
  } | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteEditingId, setNoteEditingId] = useState<string | null>(null);
  const [noteEditingDraft, setNoteEditingDraft] = useState("");
  const [noteOptionsId, setNoteOptionsId] = useState<string | null>(null);
  const [savingNote, setSavingNote] = useState(false);

  /* ── Chef staff-details modal state ── */
  const [chefStaffModal, setChefStaffModal] = useState<{
    label: string; iso: string; meal: Meal; weekKey: RosterViewWeekKey;
  } | null>(null);

  const [pendingStart, setPendingStart] = useState<string>("");
  const [savingShift, setSavingShift] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const [today, setTodayDate] = useState<Date>(() => {
    const d = new Date(0);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  useEffect(() => {
    setTodayDate(sydneyTodayDate());
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
    try {
      const staffSnap = await getDocs(collection(getDb(), "staff_onboarding"));
      const byUid = new Map<string, StaffDoc>();
      for (const d of staffSnap.docs) {
        byUid.set(d.id, { uid: d.id, ...(d.data() as Omit<StaffDoc, "uid">) });
      }
      try {
        const activeSnap = await getDocs(collection(getDb(), "staff"));
        for (const d of activeSnap.docs) {
          const data = d.data() as Omit<StaffDoc, "uid"> & { firstName?: string; lastName?: string };
          const existing = byUid.get(d.id);
          byUid.set(d.id, {
            uid: d.id,
            ...existing,
            ...data,
            firstName: data.firstName ?? existing?.firstName,
            lastName: data.lastName ?? existing?.lastName,
            role: data.role ?? existing?.role,
          });
        }
      } catch {
        /* staff collection optional */
      }
      setStaffDocs([...byUid.values()].filter((d) => d.role !== "owner"));
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

  function assignedFor(iso: string, meal: Meal, weekKey: string | RosterViewWeekKey): ShiftAssignments {
    const d =
      weekKey === "next" || weekKey === nextWeekStartISO
        ? nextWeekDoc
        : weekKey === "prev" || weekKey === prevWeekStartISO
          ? prevWeekDoc
          : weekDoc;
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

  /* ── Note helpers ── */

  function weekStateForKey(k: "current" | "next" | "prev") {
    if (k === "next") return { wDoc: nextWeekDoc, setWDoc: setNextWeekDoc, wISO: nextWeekStartISO };
    if (k === "prev") return { wDoc: prevWeekDoc, setWDoc: setPrevWeekDoc, wISO: prevWeekStartISO };
    return { wDoc: weekDoc, setWDoc: setWeekDoc, wISO: weekStartISO };
  }

  function closeNoteModal() {
    setNoteModal(null);
    setNoteDraft("");
    setNoteEditingId(null);
    setNoteEditingDraft("");
    setNoteOptionsId(null);
  }

  function noteCanBeManaged(note: NoteEntry): boolean {
    if (!user || noteModal?.weekKey === "prev") return false;
    if (note.authorUid !== user.uid) return false;
    if (isChefUser && note.authorRole !== "chef") return false;
    return true;
  }

  async function handleSaveNewNote() {
    if (!user || !noteModal) return;
    if (noteModal.weekKey === "prev") return;
    const trimmed = noteDraft.trim();
    if (!trimmed) return;
    setSavingNote(true);
    try {
      const ws = weekStateForKey(noteModal.weekKey);
      const current = normalizeNotes(ws.wDoc.notes?.[noteModal.iso]);
      const authorName =
        emailToUsername(user.email ?? "").charAt(0).toUpperCase() +
        emailToUsername(user.email ?? "").slice(1);
      const newEntry: NoteEntry = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        authorUid: user.uid,
        authorName,
        authorRole: isChefUser ? "chef" : "manager",
        text: trimmed,
        createdAt: new Date(),
      };
      const updated = [...current, newEntry];
      const updatedNotes = { ...(ws.wDoc.notes ?? {}), [noteModal.iso]: updated };
      await setDoc(
        doc(getDb(), "rosters_published", ws.wISO),
        { notes: updatedNotes },
        { merge: true },
      );
      ws.setWDoc((prev) => ({ ...prev, notes: updatedNotes }));
      setNoteDraft("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save note.");
    } finally {
      setSavingNote(false);
    }
  }

  async function handleDeleteNote(noteId: string) {
    if (!user || !noteModal) return;
    const ws = weekStateForKey(noteModal.weekKey);
    const current = normalizeNotes(ws.wDoc.notes?.[noteModal.iso]);
    const target = current.find((n) => n.id === noteId);
    if (!target || !noteCanBeManaged(target)) return;
    setSavingNote(true);
    try {
      const updated = current.filter((n) => n.id !== noteId);
      const updatedNotes = { ...(ws.wDoc.notes ?? {}), [noteModal.iso]: updated };
      await setDoc(
        doc(getDb(), "rosters_published", ws.wISO),
        { notes: updatedNotes },
        { merge: true },
      );
      ws.setWDoc((prev) => ({ ...prev, notes: updatedNotes }));
      setNoteOptionsId(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete note.");
    } finally {
      setSavingNote(false);
    }
  }

  async function handleUpdateNote(noteId: string) {
    if (!user || !noteModal) return;
    const trimmed = noteEditingDraft.trim();
    if (!trimmed) return;
    const ws = weekStateForKey(noteModal.weekKey);
    const current = normalizeNotes(ws.wDoc.notes?.[noteModal.iso]);
    const target = current.find((n) => n.id === noteId);
    if (!target || !noteCanBeManaged(target)) return;
    setSavingNote(true);
    try {
      const updated = current.map((n) => n.id === noteId ? { ...n, text: trimmed } : n);
      const updatedNotes = { ...(ws.wDoc.notes ?? {}), [noteModal.iso]: updated };
      await setDoc(
        doc(getDb(), "rosters_published", ws.wISO),
        { notes: updatedNotes },
        { merge: true },
      );
      ws.setWDoc((prev) => ({ ...prev, notes: updatedNotes }));
      setNoteEditingId(null);
      setNoteEditingDraft("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update note.");
    } finally {
      setSavingNote(false);
    }
  }

  async function publishWeek() {
    if (publishing) return;
    const rangeLabel = fmtRange(weekStart, weekEnd);

    const byStaff = new Map<string, PublishShift[]>();
    for (const d of weekDays) {
      const iso = isoDate(d);
      for (const meal of ["lunch", "dinner"] as Meal[]) {
        const assigned = weekDoc.assignments?.[iso]?.[meal] ?? {};
        for (const [uid, start] of Object.entries(assigned)) {
          if (uid.startsWith("tr_")) continue;
          const list = byStaff.get(uid) ?? [];
          list.push({ iso, meal, start });
          byStaff.set(uid, list);
        }
      }
    }

    const recipients = staffDocs.filter((s) => s.role !== "owner");
    const total = recipients.length;
    const withShifts = recipients.filter((s) => (byStaff.get(s.uid)?.length ?? 0) > 0).length;

    const ok = window.confirm(
      `Publish the roster for ${rangeLabel}?\n\n` +
        `${withShifts} of ${total} staff will be notified of their shifts.`,
    );
    if (!ok) return;

    setPublishing(true);
    try {
      await Promise.all(
        recipients.map((s) =>
          publishStaffRoster(s.uid, weekStartISO, rangeLabel, byStaff.get(s.uid) ?? []),
        ),
      );
      await setDoc(
        doc(getDb(), "rosters_published", weekStartISO),
        { publishedAt: new Date() },
        { merge: true },
      );
      alert(`Roster published. ${total} staff notified.`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to publish roster.");
    } finally {
      setPublishing(false);
    }
  }

  if (loading) return <Splash />;

  /* ── Derived note data for open modal ── */
  const noteModalAllNotes = noteModal
    ? normalizeNotes(
        noteModal.weekKey === "next"
          ? nextWeekDoc.notes?.[noteModal.iso]
          : noteModal.weekKey === "prev"
            ? prevWeekDoc.notes?.[noteModal.iso]
            : weekDoc.notes?.[noteModal.iso],
      )
    : [];
  const noteModalManagerNotes = noteModalAllNotes.filter((n) => n.authorRole === "manager");
  const noteModalChefNotes = noteModalAllNotes.filter((n) => n.authorRole === "chef");

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h1 className={styles.title}>Roster</h1>
          <p className={styles.subtitle}>{fmtRange(weekStart, weekEnd)}</p>
        </div>
        {!isChefUser && (
          <button
            type="button"
            className={styles.publishBtn}
            onClick={publishWeek}
            disabled={publishing}
          >
            {publishing ? "Publishing…" : "Publish"}
          </button>
        )}
      </header>

      {/* ── Current week strip ── */}
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
            const n = assignmentCount(weekDoc, iso, "lunch");
            if (isChefUser) {
              if (n > 0) {
                return (
                  <button
                    key={i}
                    type="button"
                    className={styles.gridCell}
                    onClick={() => setChefStaffModal({
                      label: `${DAY_LABELS_FULL[i]} Lunch`,
                      iso,
                      meal: "lunch",
                      weekKey: "current",
                    })}
                  >
                    <DotCount n={n} />
                  </button>
                );
              }
              return (
                <div key={i} className={styles.gridCellReadOnly}>
                  <DotCount n={n} />
                </div>
              );
            }
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
            const n = assignmentCount(weekDoc, iso, "dinner");
            if (isChefUser) {
              if (n > 0) {
                return (
                  <button
                    key={i}
                    type="button"
                    className={styles.gridCell}
                    onClick={() => setChefStaffModal({
                      label: `${DAY_LABELS_FULL[i]} Dinner`,
                      iso,
                      meal: "dinner",
                      weekKey: "current",
                    })}
                  >
                    <DotCount n={n} />
                  </button>
                );
              }
              return (
                <div key={i} className={styles.gridCellReadOnly}>
                  <DotCount n={n} />
                </div>
              );
            }
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
        {/* Notes row */}
        <div className={styles.gridRow}>
          <div className={styles.rowLabel}>
            <NoteIcon /> Notes
          </div>
          {weekDays.map((d, i) => {
            const iso = isoDate(d);
            const hasNotes = normalizeNotes(weekDoc.notes?.[iso]).length > 0;
            return (
              <button
                key={i}
                type="button"
                className={styles.gridCell}
                onClick={() => {
                  setNoteModal({ label: fmtNoteDate(d), iso, weekKey: "current" });
                  setNoteDraft("");
                }}
                aria-label={hasNotes ? `View notes for ${DAY_LABELS_LONG[i]}` : `Add note for ${DAY_LABELS_LONG[i]}`}
              >
                {hasNotes ? (
                  <span className={styles.noteFilled} aria-hidden="true">
                    <PencilIcon />
                  </span>
                ) : (
                  <span className={styles.notePencilFaint} aria-hidden="true">
                    <PencilIcon />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Next Week ── */}
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
              const n = assignmentCount(nextWeekDoc, iso, "lunch");
              if (isChefUser) {
                if (n > 0) {
                  return (
                    <button
                      key={i}
                      type="button"
                      className={styles.gridCell}
                      onClick={() => setChefStaffModal({
                        label: `${DAY_LABELS_FULL[i]} Lunch`,
                        iso,
                        meal: "lunch",
                        weekKey: "next",
                      })}
                    >
                      <DotCount n={n} />
                    </button>
                  );
                }
                return (
                  <div key={i} className={styles.gridCellReadOnly}>
                    <DotCount n={n} />
                  </div>
                );
              }
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
              const n = assignmentCount(nextWeekDoc, iso, "dinner");
              if (isChefUser) {
                if (n > 0) {
                  return (
                    <button
                      key={i}
                      type="button"
                      className={styles.gridCell}
                      onClick={() => setChefStaffModal({
                        label: `${DAY_LABELS_FULL[i]} Dinner`,
                        iso,
                        meal: "dinner",
                        weekKey: "next",
                      })}
                    >
                      <DotCount n={n} />
                    </button>
                  );
                }
                return (
                  <div key={i} className={styles.gridCellReadOnly}>
                    <DotCount n={n} />
                  </div>
                );
              }
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
          {/* Notes row */}
          <div className={styles.gridRow}>
            <div className={styles.rowLabel}>
              <NoteIcon /> Notes
            </div>
            {nextWeekDays.map((d, i) => {
              const iso = isoDate(d);
              const hasNotes = normalizeNotes(nextWeekDoc.notes?.[iso]).length > 0;
              return (
                <button
                  key={i}
                  type="button"
                  className={styles.gridCell}
                  onClick={() => {
                    setNoteModal({ label: fmtNoteDate(d), iso, weekKey: "next" });
                    setNoteDraft("");
                  }}
                  aria-label={hasNotes ? `View notes for ${DAY_LABELS_LONG[i]}` : `Add note for ${DAY_LABELS_LONG[i]}`}
                >
                  {hasNotes ? (
                    <span className={styles.noteFilled} aria-hidden="true"><PencilIcon /></span>
                  ) : (
                    <span className={styles.notePencilFaint} aria-hidden="true"><PencilIcon /></span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Previous Week (accordion) ── */}
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
                  const n = assignmentCount(prevWeekDoc, iso, "lunch");
                  if (isChefUser && n > 0) {
                    return (
                      <button
                        key={i}
                        type="button"
                        className={styles.gridCell}
                        onClick={() => setChefStaffModal({
                          label: `${DAY_LABELS_FULL[i]} Lunch`,
                          iso,
                          meal: "lunch",
                          weekKey: "prev",
                        })}
                      >
                        <DotCount n={n} />
                      </button>
                    );
                  }
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
                  const n = assignmentCount(prevWeekDoc, iso, "dinner");
                  if (isChefUser && n > 0) {
                    return (
                      <button
                        key={i}
                        type="button"
                        className={styles.gridCell}
                        onClick={() => setChefStaffModal({
                          label: `${DAY_LABELS_FULL[i]} Dinner`,
                          iso,
                          meal: "dinner",
                          weekKey: "prev",
                        })}
                      >
                        <DotCount n={n} />
                      </button>
                    );
                  }
                  return (
                    <div key={i} className={styles.gridCellReadOnly}>
                      <DotCount n={n} />
                    </div>
                  );
                })}
              </div>
              {/* Notes row — prev week (read-only) */}
              <div className={styles.gridRow}>
                <div className={styles.rowLabel}><NoteIcon /> Notes</div>
                {prevWeekDays.map((d, i) => {
                  const iso = isoDate(d);
                  const hasNotes = normalizeNotes(prevWeekDoc.notes?.[iso]).length > 0;
                  return (
                    <button
                      key={i}
                      type="button"
                      className={styles.gridCell}
                      onClick={() => {
                        setNoteModal({ label: fmtNoteDate(d), iso, weekKey: "prev" });
                        setNoteDraft("");
                      }}
                      aria-label={`View notes for ${DAY_LABELS_LONG[i]}`}
                    >
                      {hasNotes ? (
                        <span className={styles.noteFilled} aria-hidden="true"><PencilIcon /></span>
                      ) : (
                        <span className={styles.notePencilFaint} aria-hidden="true"><PencilIcon /></span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ── Holiday Requests — hidden for chef ── */}
      {!isChefUser && <section className={styles.card}>
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
      </section>}

      {/* ── Availability Change Requests — hidden for chef ── */}
      {!isChefUser && <section className={styles.card}>
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
      </section>}

      {/* ═══════════════════════════════════════════════════════
          Notes modal — redesigned (Screenshot 1 design)
          ═══════════════════════════════════════════════════════ */}
      {noteModal && (
        <div
          className={styles.noteModalBackdrop}
          role="dialog"
          aria-modal="true"
          aria-label="Notes"
          onClick={closeNoteModal}
        >
          <div className={styles.noteModalStack} onClick={(e) => e.stopPropagation()}>
            <div
              className={styles.noteModalSheet}
              onClick={() => setNoteOptionsId(null)}
            >
              {/* Drag handle */}
              <div className={styles.noteModalHandle} aria-hidden="true" />

              {/* Header */}
              <div className={styles.noteModalHeader}>
                <span className={styles.noteModalDateLabel}>{noteModal.label}</span>
                <button
                  type="button"
                  className={styles.noteModalCloseBtn}
                  onClick={closeNoteModal}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              {/* Info banner */}
              <div className={styles.noteModalBanner}>
                <span className={styles.noteModalBannerIcon}><InfoIcon /></span>
                <span>Notes are visible to all managers and Head Chef.</span>
              </div>

              {/* Scrollable note list — always show Manager + Head Chef sections */}
              <div className={styles.noteModalScroll}>
                <div className={styles.noteSectionBlock}>
                  <div className={styles.noteSectionGrid}>
                    <div className={`${styles.noteSectionIcon} ${styles.noteSectionIconManager}`}>
                      <PersonIcon />
                    </div>
                    <div className={styles.noteSectionContent}>
                      <p className={styles.noteSectionTitle}>MANAGER NOTE</p>
                      <NoteEntriesList
                        notes={noteModalManagerNotes}
                        userUid={user?.uid}
                        weekKey={noteModal.weekKey}
                        isChefViewer={isChefUser}
                        noteEditingId={noteEditingId}
                        noteEditingDraft={noteEditingDraft}
                        setNoteEditingId={setNoteEditingId}
                        setNoteEditingDraft={setNoteEditingDraft}
                        noteOptionsId={noteOptionsId}
                        setNoteOptionsId={setNoteOptionsId}
                        savingNote={savingNote}
                        onUpdate={handleUpdateNote}
                        onDelete={handleDeleteNote}
                      />
                    </div>
                  </div>
                </div>

                <div className={styles.noteSectionDivider} aria-hidden="true" />

                <div className={styles.noteSectionBlock}>
                  <div className={styles.noteSectionGrid}>
                    <div className={`${styles.noteSectionIcon} ${styles.noteSectionIconChef}`}>
                      <ChefHatIcon />
                    </div>
                    <div className={styles.noteSectionContent}>
                      <p className={styles.noteSectionTitle}>HEAD CHEF NOTE</p>
                      <NoteEntriesList
                        notes={noteModalChefNotes}
                        userUid={user?.uid}
                        weekKey={noteModal.weekKey}
                        isChefViewer={isChefUser}
                        noteEditingId={noteEditingId}
                        noteEditingDraft={noteEditingDraft}
                        setNoteEditingId={setNoteEditingId}
                        setNoteEditingDraft={setNoteEditingDraft}
                        noteOptionsId={noteOptionsId}
                        setNoteOptionsId={setNoteOptionsId}
                        savingNote={savingNote}
                        onUpdate={handleUpdateNote}
                        onDelete={handleDeleteNote}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Input area — hidden for prev week */}
              {noteModal.weekKey !== "prev" && (
                <div className={styles.noteInputSection}>
                  <div className={styles.noteInputWrap}>
                    <span className={styles.noteInputIcon}><PencilIcon /></span>
                    <textarea
                      className={styles.noteInputTextarea}
                      placeholder="Write your note…"
                      value={noteDraft}
                      maxLength={500}
                      rows={2}
                      onChange={(e) => setNoteDraft(e.target.value)}
                    />
                    <span className={styles.noteCharCount}>{noteDraft.length} / 500</span>
                  </div>
                  <button
                    type="button"
                    className={styles.noteSaveBtn}
                    disabled={savingNote || !noteDraft.trim()}
                    onClick={handleSaveNewNote}
                  >
                    {savingNote ? "Saving…" : "Save Note"}
                  </button>
                </div>
              )}
            </div>
            <p className={styles.noteModalFooter}>
              Tap a day&apos;s Notes icon to view all notes for that day.
            </p>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          Day-meal assignment modal — hidden for chef
          ═══════════════════════════════════════════════════════ */}
      {!isChefUser && modalCell && (() => {
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

              <div className={styles.staffList}>
                {(() => {
                  const cellDayKey = DAY_KEYS[dowIdx] as string | undefined;
                  type WarnInfo = { type: "holiday" | "unavailability" };
                  const warningMap = new Map<string, WarnInfo>();
                  for (const d of staffDocs) {
                    for (const r of d.holidayRequests ?? []) {
                      if (r.status !== "approved") continue;
                      const s = tsDate(r.startDate);
                      const e = tsDate(r.endDate);
                      if (s && e) {
                        const sDay = new Date(s); sDay.setHours(0, 0, 0, 0);
                        const eDay = new Date(e); eDay.setHours(23, 59, 59, 999);
                        if (cellDate >= sDay && cellDate <= eDay) {
                          warningMap.set(d.uid, { type: "holiday" });
                          break;
                        }
                      }
                    }
                    if (warningMap.has(d.uid) || !cellDayKey) continue;
                    const approvedChanges = (d.availabilityRequests ?? [])
                      .filter((r) => r.status === "approved" && r.requested?.[cellDayKey]);
                    if (approvedChanges.length > 0) {
                      const avail = approvedChanges[approvedChanges.length - 1].requested?.[cellDayKey];
                      if (avail?.kind === "unavailable") {
                        warningMap.set(d.uid, { type: "unavailability" });
                      }
                    }
                  }

                  type StaffEntry = {
                    uid: string; name: string; role: string;
                    isTemp: boolean; warning: WarnInfo | null;
                  };
                  const real: StaffEntry[] = staffDocs
                    .map((d) => ({
                      uid: d.uid,
                      name: displayName(d),
                      role: staffRoleLabel(d.role),
                      isTemp: false,
                      warning: warningMap.get(d.uid) ?? null,
                    }))
                    .sort((a, b) => a.name.localeCompare(b.name));
                  const temp: StaffEntry[] = Object.keys(cur)
                    .filter((u) => u.startsWith("tr_"))
                    .map((u) => ({
                      uid: u,
                      name: u.startsWith("tr_kitchen_") ? "TR Kitchen Staff" : "TR Hall Staff",
                      role: "TR",
                      isTemp: true,
                      warning: null,
                    }));

                  const available = [...real.filter(s => !s.warning), ...temp];
                  const warned = real.filter(s => s.warning);
                  const holidayCount = warned.filter(s => s.warning?.type === "holiday").length;
                  const unavailCount = warned.filter(s => s.warning?.type === "unavailability").length;
                  const warnLabel = holidayCount > 0 && unavailCount > 0
                    ? `On Holiday / Unavailable (${warned.length})`
                    : holidayCount > 0
                      ? `On Holiday (${warned.length})`
                      : `Unavailable (${warned.length})`;

                  const renderRow = (s: StaffEntry) => {
                    const assigned = cur[s.uid];
                    return (
                      <div key={s.uid} className={`${styles.staffRow} ${s.warning ? styles.staffRowWarn : ""}`}>
                        <span className={styles.staffDot} style={{ background: colorForUid(s.uid) }} />
                        {s.warning ? (
                          <div className={styles.staffNameBlock}>
                            <span className={styles.staffName}>{s.name}</span>
                            <span className={`${styles.warnPill} ${s.warning.type === "holiday" ? styles.warnPillHoliday : styles.warnPillUnavail}`}>
                              {s.warning.type === "holiday" ? "ON HOLIDAY" : "UNAVAILABLE"}
                            </span>
                            <span className={styles.warnSub}>
                              {s.warning.type === "holiday" ? "Approved Holiday" : "Approved Change"}
                            </span>
                          </div>
                        ) : (
                          <span className={styles.staffName}>{s.name}</span>
                        )}
                        <span className={styles.staffRole}>{s.role}</span>
                        <button
                          type="button"
                          className={`${styles.staffStartBtn} ${assigned ? styles.staffStartBtnAssigned : ""}`}
                          disabled={savingShift}
                          onClick={() => {
                            if (s.warning) {
                              setConfirmAssign({
                                uid: s.uid, name: s.name,
                                startTime: pendingStart,
                                warnType: s.warning.type,
                                cellDate,
                              });
                            } else {
                              assignStaff(s.uid, pendingStart);
                            }
                          }}
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
                      </div>
                    );
                  };

                  return (
                    <>
                      <div className={styles.staffSectionHead}>
                        <span className={styles.staffSectionIconGreen}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
                          </svg>
                        </span>
                        <span className={styles.staffSectionLabel}>Available Staff</span>
                      </div>
                      {available.map(renderRow)}

                      {warned.length > 0 && (
                        <>
                          <button
                            type="button"
                            className={`${styles.staffSectionHead} ${styles.staffSectionHeadWarn}`}
                            onClick={() => setWarnSectionOpen((o) => !o)}
                          >
                            <span className={styles.staffSectionIconOrange}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 2L1 21h22L12 2zm0 3.5L20.5 19h-17L12 5.5zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z"/>
                              </svg>
                            </span>
                            <span className={styles.staffSectionLabel}>{warnLabel}</span>
                            <svg
                              className={`${styles.staffSectionChevron} ${warnSectionOpen ? styles.staffSectionChevronOpen : ""}`}
                              width="14" height="14" viewBox="0 0 24 24" fill="currentColor"
                            >
                              <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
                            </svg>
                          </button>
                          {warnSectionOpen && warned.map(renderRow)}
                        </>
                      )}
                    </>
                  );
                })()}
              </div>

              <footer className={styles.modalFoot}>
                <button
                  type="button"
                  className={styles.modalDoneBtn}
                  onClick={() => setModalCell(null)}
                >
                  Done
                </button>
              </footer>

              {confirmAssign && (
                <div className={styles.confirmOverlay} onClick={() => setConfirmAssign(null)}>
                  <div className={styles.confirmCard} onClick={(e) => e.stopPropagation()}>
                    <div className={styles.confirmIconWrap}>
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2L1 21h22L12 2zm0 3.5L20.5 19h-17L12 5.5zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z"/>
                      </svg>
                    </div>
                    <h3 className={styles.confirmTitle}>
                      {confirmAssign.warnType === "holiday" ? "Holiday Approved" : "Unavailability Approved"}
                    </h3>
                    <p className={styles.confirmBody}>
                      {confirmAssign.name} has approved {confirmAssign.warnType === "holiday" ? "holiday" : "unavailability"} on {DAY_LABELS_FULL[(confirmAssign.cellDate.getDay() + 6) % 7] ?? ""}, {fmtMonDay(confirmAssign.cellDate)}.
                    </p>
                    <p className={styles.confirmBody}>Do you want to assign this shift anyway?</p>
                    <div className={styles.confirmBtns}>
                      <button
                        type="button"
                        className={styles.confirmCancelBtn}
                        onClick={() => setConfirmAssign(null)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className={styles.confirmProceedBtn}
                        onClick={() => {
                          assignStaff(confirmAssign.uid, confirmAssign.startTime);
                          setConfirmAssign(null);
                        }}
                      >
                        Assign Anyway
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ═══════════════════════════════════════════════════════
          Chef Staff Details Modal (Feature 2)
          ═══════════════════════════════════════════════════════ */}
      {chefStaffModal && (
        <div
          className={styles.modalBackdrop}
          role="dialog"
          aria-modal="true"
          aria-label="Staff details"
          onClick={() => setChefStaffModal(null)}
        >
          <div className={styles.chefStaffModalBox} onClick={(e) => e.stopPropagation()}>
            <header className={styles.modalHead}>
              <div className={styles.modalTitleWrap}>
                <h2 className={styles.modalTitle}>{chefStaffModal.label}</h2>
              </div>
              <button
                type="button"
                className={styles.modalClose}
                onClick={() => setChefStaffModal(null)}
                aria-label="Close"
              >
                ×
              </button>
            </header>

            <div className={styles.chefStaffList}>
              {Object.keys(assignedFor(chefStaffModal.iso, chefStaffModal.meal, chefStaffModal.weekKey)).length === 0 ? (
                <p className={styles.chefStaffEmpty}>No staff assigned for this shift.</p>
              ) : (
                Object.entries(assignedFor(chefStaffModal.iso, chefStaffModal.meal, chefStaffModal.weekKey))
                  .map(([uid, startTime]) => ({
                    uid,
                    ...resolveShiftStaff(uid, startTime, staffDocs),
                  }))
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map(({ uid, name, startTime }) => (
                      <div key={uid} className={styles.chefStaffRow}>
                        <span className={styles.chefStaffDot} style={{ background: colorForUid(uid) }} />
                        <span className={styles.chefStaffName}>{name}</span>
                        <span className={styles.chefStaffTime}>
                          {startTime ? `${startTime} Start` : "—"}
                        </span>
                      </div>
                    ))
              )}
            </div>

            <footer className={styles.modalFoot}>
              <button
                type="button"
                className={styles.modalDoneBtn}
                onClick={() => setChefStaffModal(null)}
              >
                Close
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* ── Availability Overview — hidden for chef ── */}
      {!isChefUser && <section className={styles.card}>
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
      </section>}
    </div>
  );
}

/* ── Icons ── */

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
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}
function PencilIcon() {
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
function InfoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}
function PersonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
function ChefHatIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 13.87A4 4 0 0 1 7.41 6a5.11 5.11 0 0 1 1.05-1.54 5 5 0 0 1 7.08 0A5.11 5.11 0 0 1 16.59 6 4 4 0 0 1 18 13.87V21H6z" />
      <line x1="6" y1="17" x2="18" y2="17" />
    </svg>
  );
}
