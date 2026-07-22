"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, doc, getDocs, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import styles from "./page.module.css";

type ShiftFromApi = {
  id: string;
  teamMemberId: string;
  dateISO: string;
  startAt: string;
  endAt: string | null;
  hours: number;
  hourlyRateCents: number | null;
};

type TeamMemberFromApi = { firstName?: string; lastName?: string };

type EditDoc = {
  shiftId: string;
  dateISO: string;
  originalStartAt: string;
  originalEndAt: string | null;
  startAt: string;
  endAt: string | null;
};

function fmtClockTime(iso: string | null): { hhmm: string; ampm: string } {
  if (!iso) return { hhmm: "--:--", ampm: "" };
  const t = iso.slice(11, 16);
  const [hStr, mStr] = t.split(":");
  let h = parseInt(hStr, 10);
  if (Number.isNaN(h)) return { hhmm: t, ampm: "" };
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return { hhmm: `${h}:${mStr}`, ampm };
}

function fmtHours(h: number): string {
  return `${h.toFixed(2)} hrs`;
}

function nameOfTeamMember(id: string, tm: TeamMemberFromApi | undefined): string {
  const first = (tm?.firstName ?? "").trim();
  const last = (tm?.lastName ?? "").trim();
  if (first || last) return `${first}${last ? " " + last : ""}`;
  return id.slice(0, 6);
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const a = (parts[0]?.[0] ?? "?").toUpperCase();
  const b = (parts[1]?.[0] ?? "").toUpperCase();
  return (a + b) || "??";
}

function colorForMemberId(id: string): string {
  const STAFF_COLORS = [
    "#e91e63", "#9c27b0", "#ff7043", "#26a69a", "#42a5f5",
    "#ffb300", "#ec407a", "#26c6da", "#7e57c2", "#66bb6a",
  ];
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return STAFF_COLORS[h % STAFF_COLORS.length];
}

function replaceHHMM(iso: string, hhmm: string): string {
  return iso.slice(0, 11) + hhmm + iso.slice(16);
}

type Props = {
  dateISO: string;
  entries: ShiftFromApi[];
  teamMembers: Record<string, TeamMemberFromApi>;
  userId: string;
};

export function DayExpandedPanel({ dateISO, entries, teamMembers, userId }: Props) {
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Record<string, EditDoc>>({});
  const [extras, setExtras] = useState<ShiftFromApi[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [editingField, setEditingField] = useState<{ shiftId: string; field: "start" | "end" } | null>(null);
  const [savingEditId, setSavingEditId] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const loadDayMeta = useCallback(async () => {
    setLoading(true);
    setEditError(null);
    try {
      const [editsSnap, extrasSnap] = await Promise.all([
        getDocs(query(collection(getDb(), "timesheet_edits"), where("dateISO", "==", dateISO))),
        getDocs(query(collection(getDb(), "timesheet_extra_shifts"), where("dateISO", "==", dateISO))),
      ]);
      const editMap: Record<string, EditDoc> = {};
      for (const d of editsSnap.docs) {
        editMap[d.id] = { shiftId: d.id, ...(d.data() as Omit<EditDoc, "shiftId">) };
      }
      const extraRows: ShiftFromApi[] = extrasSnap.docs.map((d) => {
        const data = d.data() as Partial<ShiftFromApi>;
        return {
          id: d.id,
          teamMemberId: data.teamMemberId ?? "",
          dateISO: data.dateISO ?? dateISO,
          startAt: data.startAt ?? "",
          endAt: data.endAt ?? null,
          hours: typeof data.hours === "number" ? data.hours : 0,
          hourlyRateCents: typeof data.hourlyRateCents === "number" ? data.hourlyRateCents : null,
        };
      });
      setEdits(editMap);
      setExtras(extraRows);
    } catch (err) {
      console.error("[timesheets] day panel load failed:", err);
      setEdits({});
      setExtras([]);
    } finally {
      setLoading(false);
    }
  }, [dateISO]);

  useEffect(() => {
    void loadDayMeta();
  }, [loadDayMeta]);

  function withEdit(s: ShiftFromApi): ShiftFromApi {
    const e = edits[s.id];
    if (!e) return s;
    let hours = s.hours;
    if (e.startAt && e.endAt) {
      hours = Math.round(((new Date(e.endAt).getTime() - new Date(e.startAt).getTime()) / 3_600_000) * 100) / 100;
      if (hours < 0) hours = 0;
    }
    return { ...s, startAt: e.startAt, endAt: e.endAt, hours };
  }

  const visibleShifts = useMemo(() => {
    const merged = [...entries, ...extras];
    return merged
      .filter((s) => s.dateISO === dateISO && !dismissed.has(s.id))
      .map(withEdit)
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
  }, [entries, extras, dismissed, dateISO, edits]);

  async function saveTimeEdit(shift: ShiftFromApi, field: "start" | "end", newHHMM: string) {
    if (!/^\d{2}:\d{2}$/.test(newHHMM)) return;
    const existing = edits[shift.id];
    const currentStart = existing?.startAt ?? shift.startAt;
    const currentEnd = existing?.endAt ?? shift.endAt;
    const newStart = field === "start" ? replaceHHMM(currentStart, newHHMM) : currentStart;
    const newEnd = field === "end" && currentEnd ? replaceHHMM(currentEnd, newHHMM) : currentEnd;

    const patch: EditDoc = {
      shiftId: shift.id,
      dateISO: shift.dateISO,
      originalStartAt: existing?.originalStartAt ?? shift.startAt,
      originalEndAt: existing?.originalEndAt ?? shift.endAt,
      startAt: newStart,
      endAt: newEnd,
    };

    setSavingEditId(shift.id);
    setEditError(null);
    try {
      await setDoc(
        doc(getDb(), "timesheet_edits", shift.id),
        { ...patch, updatedAt: serverTimestamp(), updatedBy: userId },
        { merge: true },
      );
      setEdits((prev) => ({ ...prev, [shift.id]: patch }));
      setEditingField(null);
    } catch (err) {
      console.error("[timesheet_edits] save failed:", err);
      setEditError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSavingEditId(null);
    }
  }

  if (loading) {
    return <div className={styles.panelLoading}>Loading shifts…</div>;
  }

  if (visibleShifts.length === 0) {
    return <div className={styles.panelLoading}>No shifts recorded for this day.</div>;
  }

  return (
    <div className={styles.expandedPanel}>
      {editError && <p className={styles.errorBanner}>{editError}</p>}
      {visibleShifts.map((s) => {
        const original = [...entries, ...extras].find((v) => v.id === s.id);
        const name = nameOfTeamMember(s.teamMemberId, teamMembers[s.teamMemberId]);
        const start = fmtClockTime(s.startAt);
        const end = fmtClockTime(s.endAt);
        const editRec = edits[s.id];
        const isEdited = !!editRec;
        const isSaving = savingEditId === s.id;
        const editingStart = editingField?.shiftId === s.id && editingField.field === "start";
        const editingEnd = editingField?.shiftId === s.id && editingField.field === "end";

        return (
          <div key={s.id} className={styles.shiftCard}>
            <span
              className={styles.avatarColor}
              style={{ background: colorForMemberId(s.teamMemberId) }}
              aria-hidden="true"
            >
              {initialsOf(name)}
            </span>
            <div>
              <p className={styles.shiftName}>{name}</p>
              <div className={styles.timeRow}>
                {editingStart ? (
                  <input
                    type="time"
                    className={styles.timeInput}
                    defaultValue={s.startAt.slice(11, 16)}
                    autoFocus
                    disabled={isSaving}
                    onBlur={(e) => {
                      const v = e.currentTarget.value;
                      if (v && v !== s.startAt.slice(11, 16)) void saveTimeEdit(s, "start", v);
                      else setEditingField(null);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className={styles.timeChip}
                    onClick={() => setEditingField({ shiftId: s.id, field: "start" })}
                  >
                    <span className={styles.timeChipMain}>{start.hhmm}</span>
                    <span className={styles.timeChipAmpm}>{start.ampm}</span>
                  </button>
                )}
                <span className={styles.timeSep}>—</span>
                {editingEnd ? (
                  <input
                    type="time"
                    className={styles.timeInput}
                    defaultValue={s.endAt ? s.endAt.slice(11, 16) : ""}
                    autoFocus
                    disabled={isSaving}
                    onBlur={(e) => {
                      const v = e.currentTarget.value;
                      if (v && (!s.endAt || v !== s.endAt.slice(11, 16))) void saveTimeEdit(s, "end", v);
                      else setEditingField(null);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className={styles.timeChip}
                    onClick={() => setEditingField({ shiftId: s.id, field: "end" })}
                  >
                    <span className={styles.timeChipMain}>{end.hhmm}</span>
                    <span className={styles.timeChipAmpm}>{end.ampm}</span>
                  </button>
                )}
              </div>
              {isEdited && original && editRec ? (
                <p className={styles.editedNote}>
                  <span className={styles.editedBadge}>EDITED</span>
                  {" · was "}
                  {(() => {
                    const os = fmtClockTime(editRec.originalStartAt || original.startAt);
                    const oe = fmtClockTime(editRec.originalEndAt || original.endAt);
                    return `${os.hhmm} ${os.ampm} – ${oe.hhmm} ${oe.ampm}`;
                  })()}
                </p>
              ) : null}
            </div>
            <span className={styles.shiftHoursBadge}>{fmtHours(s.hours)}</span>
            <button
              type="button"
              className={styles.deleteBtn}
              aria-label={`Remove ${name}'s shift from view`}
              onClick={() => setDismissed((prev) => new Set(prev).add(s.id))}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
