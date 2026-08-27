"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { addDoc, collection, deleteDoc, doc, getDocs, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { isOwner } from "@/lib/permissions";
import { dismissSquareShift, loadDismissedShiftIdsForDay } from "@/lib/timesheet-dismiss-client";
import { serviceHeadingAt, sortShiftsByServiceThenStart } from "@/lib/timesheet-sort";
import { ROUNDING_STEP_SECONDS } from "@/lib/timesheet-rounding";
import {
  hoursOfWindow,
  paidWindow,
  paidWindowAfterEdit,
} from "@/lib/timesheet-window";
import Splash from "@/components/Splash";
import CalendarPicker from "@/components/CalendarPicker";
import styles from "./page.module.css";

/*
 * Day Details — drill-down from /payroll/timesheets showing every shift
 * for a single calendar day. Square supplies the base import; time edits
 * and backfills are saved in Firestore only (never sent to Square).
 */

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

/**
 * A per-shift override document stored in Firestore. Square is read-only;
 * corrected start/end times live here and are merged for display/payroll.
 */
type EditDoc = {
  shiftId: string;
  dateISO: string;
  originalStartAt: string;
  originalEndAt: string | null;
  startAt: string;
  endAt: string | null;
};

/* ── formatting ──────────────────────────────────────────────────── */

function fmtDayTitle(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function fmtClockTime(iso: string | null): { hhmm: string; ampm: string } {
  if (!iso) return { hhmm: "--:--", ampm: "" };
  const t = iso.slice(11, 16); // HH:MM in the location's timezone
  const [hStr, mStr] = t.split(":");
  let h = parseInt(hStr, 10);
  if (Number.isNaN(h)) return { hhmm: t, ampm: "" };
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return { hhmm: `${h}:${mStr}`, ampm };
}

function fmtHours(h: number): string {
  return `${h.toFixed(2)}h`;
}

function nameOfTeamMember(id: string, tm: TeamMemberFromApi | undefined): string {
  const first = (tm?.firstName ?? "").trim();
  const last = (tm?.lastName ?? "").trim();
  if (first || last) return `${first}${last ? " " + last : ""}`;
  return id.slice(0, 6);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const a = (parts[0]?.[0] ?? "?").toUpperCase();
  const b = (parts[1]?.[0] ?? "").toUpperCase();
  return (a + b) || "??";
}


/* ── page ────────────────────────────────────────────────────────── */

export default function DayDetailsPage() {
  const router = useRouter();
  const params = useParams<{ date: string }>();
  const dateISO = params?.date ?? "";

  const { user, loading: authLoading } = useAuth();
  const allowed = isOwner(user);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [shifts, setShifts] = useState<ShiftFromApi[]>([]);
  const [teamMembers, setTeamMembers] = useState<Record<string, TeamMemberFromApi>>({});
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [dateOpen, setDateOpen] = useState(false);
  const [edits, setEdits] = useState<Record<string, EditDoc>>({});
  const [editingField, setEditingField] = useState<{ shiftId: string; field: "start" | "end" } | null>(null);  const [savingEditId, setSavingEditId] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [recentlySaved, setRecentlySaved] = useState<Set<string>>(new Set());
  const [extraShifts, setExtraShifts] = useState<ShiftFromApi[]>([]);
  const [extraIds, setExtraIds] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<{ teamMemberId: string; startHHMM: string; endHHMM: string }>({
    teamMemberId: "",
    startHHMM: "10:00",
    endHHMM: "14:30",
  });
  const [savingAdd, setSavingAdd] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!dateISO) return;
    setBusy(true);
    setFetchError(null);
    try {
      // Square Labor shifts + team members.
      const res = await fetch(
        `/api/square/timesheets?startDate=${encodeURIComponent(dateISO)}&endDate=${encodeURIComponent(dateISO)}`,
        { cache: "no-store" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `Fetch failed (${res.status})`);
      setShifts(Array.isArray(data.shifts) ? (data.shifts as ShiftFromApi[]) : []);
      setTeamMembers(
        data.teamMembers && typeof data.teamMembers === "object"
          ? (data.teamMembers as Record<string, TeamMemberFromApi>)
          : {},
      );

      // Local time overrides for this day. Keyed by shift id.
      try {
        const snap = await getDocs(
          query(collection(getDb(), "timesheet_edits"), where("dateISO", "==", dateISO)),
        );
        const map: Record<string, EditDoc> = {};
        for (const d of snap.docs) map[d.id] = { shiftId: d.id, ...(d.data() as Omit<EditDoc, "shiftId">) };
        setEdits(map);
      } catch (err) {
        console.warn("[day-details] edits fetch failed:", err);
        setEdits({});
      }

      // App-local backfilled shifts (not in Square Labor). We store them
      // shaped the same as Square rows so the render code doesn't care.
      try {
        const [snap, dismissedIds] = await Promise.all([
          getDocs(
            query(collection(getDb(), "timesheet_extra_shifts"), where("dateISO", "==", dateISO)),
          ),
          loadDismissedShiftIdsForDay(dateISO),
        ]);
        const extras: ShiftFromApi[] = snap.docs.map((d) => {
          const data = d.data() as Partial<ShiftFromApi>;
          return {
            id: d.id,
            teamMemberId: data.teamMemberId ?? "",
            dateISO: data.dateISO ?? dateISO,
            startAt: data.startAt ?? "",
            endAt: data.endAt ?? null,
            hours: typeof data.hours === "number" ? data.hours : 0,
            hourlyRateCents:
              typeof data.hourlyRateCents === "number" ? data.hourlyRateCents : null,
          };
        });
        setExtraShifts(extras);
        setExtraIds(new Set(extras.map((row) => row.id)));
        setDismissed(dismissedIds);
      } catch (err) {
        console.warn("[day-details] extra shifts fetch failed:", err);
        setExtraShifts([]);
        setExtraIds(new Set());
        setDismissed(new Set());
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Square unreachable.";
      console.error("[day-details] fetch failed:", err);
      setFetchError(msg);
      setShifts([]);
      setTeamMembers({});
    } finally {
      setBusy(false);
      setLoading(false);
    }
  }, [dateISO]);

  useEffect(() => {
    if (authLoading || !allowed) return;
    void load();
  }, [authLoading, allowed, load]);

  const visibleShifts = useMemo(() => {
    const merged = [...shifts, ...extraShifts];
    return merged.filter((s) => s.dateISO === dateISO && !dismissed.has(s.id));
  }, [shifts, extraShifts, dismissed, dateISO]);

  /** Effective (possibly-edited) shift used by the render code. */
  function withEdit(s: ShiftFromApi): ShiftFromApi {
    const e = edits[s.id];
    if (!e) return s;
    const startAt = e.startAt;
    const endAt = e.endAt;
    // Recompute hours from the edited start/end. We drop break subtraction
    // when times are overridden — otherwise the two numbers stop matching
    // what the owner just typed.
    const hours = startAt && endAt ? hoursOfWindow(startAt, endAt) : s.hours;
    return { ...s, startAt, endAt, hours };
  }

  const effectiveShifts = useMemo(
    () => sortShiftsByServiceThenStart(visibleShifts.map(withEdit), teamMembers),
    [visibleShifts, edits, teamMembers],
  );
  const totalHours = useMemo(
    () => effectiveShifts.reduce((sum, s) => sum + s.hours, 0),
    [effectiveShifts],
  );

  async function submitAddShift() {
    if (!user) return;
    if (!addForm.teamMemberId) { setAddError("Pick a staff member."); return; }
    if (!/^\d{2}:\d{2}$/.test(addForm.startHHMM) || !/^\d{2}:\d{2}$/.test(addForm.endHHMM)) {
      setAddError("Enter times in HH:MM format.");
      return;
    }
    // The store's real offset for this date, rather than one copied off a
    // neighbouring shift or assumed to be standard time. Sydney sits at +11:00
    // for half the year, and a backfill typed in summer used to be filed an
    // hour out whenever the day had no Square shift to borrow from.
    const { startAt, endAt } = paidWindow(dateISO, addForm.startHHMM, addForm.endHHMM);
    const hours = hoursOfWindow(startAt, endAt);
    if (hours <= 0) {
      setAddError("End time must be after start time.");
      return;
    }

    setSavingAdd(true);
    setAddError(null);
    try {
      const ref = await addDoc(collection(getDb(), "timesheet_extra_shifts"), {
        teamMemberId: addForm.teamMemberId,
        dateISO,
        startAt,
        endAt,
        hours,
        hourlyRateCents: null,
        source: "app-local",
        createdAt: serverTimestamp(),
        createdBy: user.uid,
      });
      setExtraShifts((prev) => [
        ...prev,
        {
          id: ref.id,
          teamMemberId: addForm.teamMemberId,
          dateISO,
          startAt,
          endAt,
          hours,
          hourlyRateCents: null,
        },
      ]);
      setAddOpen(false);
      setAddForm({ teamMemberId: "", startHHMM: "10:00", endHHMM: "14:30" });
    } catch (err) {
      console.error("[timesheet_extra_shifts] add failed:", err);
      setAddError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSavingAdd(false);
    }
  }

  async function saveTimeEdit(shift: ShiftFromApi, field: "start" | "end", newHHMM: string) {
    if (!user) return;
    if (!/^\d{2}:\d{2}$/.test(newHHMM)) return;
    const existing = edits[shift.id];
    const currentStart = existing?.startAt ?? shift.startAt;
    const currentEnd = existing?.endAt ?? shift.endAt;
    // Rebuilt against the day the shift started, so a retyped finish time can
    // never keep a date the shift no longer has. Patching the HH:MM into the
    // end's own string left a Square auto-close sitting a day out and paid it.
    const { startAt: newStart, endAt: newEnd } = paidWindowAfterEdit(
      currentStart,
      currentEnd,
      field,
      newHHMM,
    );
    if (hoursOfWindow(newStart, newEnd) <= 0) {
      setEditError("End time must be after start time.");
      return;
    }

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
        { ...patch, updatedAt: serverTimestamp(), updatedBy: user.uid },
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

  async function removeShift(shift: ShiftFromApi) {
    if (!user) return;
    if (extraIds.has(shift.id)) {
      try {
        await deleteDoc(doc(getDb(), "timesheet_extra_shifts", shift.id));
        void load();
      } catch (err) {
        console.error("[timesheet_extra_shifts] delete failed:", err);
        setEditError(err instanceof Error ? err.message : "Delete failed.");
      }
      return;
    }
    try {
      await dismissSquareShift(shift, user.uid);
      setDismissed((prev) => new Set(prev).add(shift.id));
    } catch (err) {
      console.error("[timesheet_dismissed] save failed:", err);
      setEditError(err instanceof Error ? err.message : "Delete failed.");
    }
  }

  if (authLoading || loading) return <Splash />;
  if (!allowed) return <div className={styles.page}><p>Owner access only.</p></div>;

  return (
    <div className={styles.page}>
      <button
        type="button"
        className={styles.backBtn}
        onClick={() => router.push("/payroll/timesheets")}
        aria-label="Back to timesheets"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      <header className={styles.header}>
        <p className={styles.eyebrow}>DAY DETAILS</p>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{dateISO ? fmtDayTitle(dateISO) : ""}</h1>
          <button
            type="button"
            className={styles.datePickBtn}
            onClick={() => setDateOpen(true)}
            aria-label="Pick another day"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span aria-hidden="true">▾</span>
          </button>
          <span className={styles.hoursPill}>{fmtHours(totalHours)}</span>
        </div>
      </header>

      {dateOpen && (
        <CalendarPicker
          value={dateISO}
          maxDate={new Date().toISOString().slice(0, 10)}
          singleOnly
          onChange={(d) => router.push(`/payroll/timesheets/${d}`)}
          onRangeChange={() => { /* single only */ }}
          onClose={() => setDateOpen(false)}
        />
      )}

      {/* Add shift + Refresh row */}
      <div className={styles.actionRow}>
        <button
          type="button"
          className={styles.addShiftInlineBtn}
          onClick={() => { setAddError(null); setAddOpen(true); }}
        >
          <span aria-hidden="true">+</span> Add shift
        </button>
        <button
          type="button"
          className={styles.refreshBtn}
          onClick={() => void load()}
          disabled={busy}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>{" "}
          Refresh
        </button>
      </div>

      {fetchError && <p className={styles.errorBanner}>Square Labor: {fetchError}</p>}
      {busy && !fetchError && <p className={styles.busyBanner}>Refreshing…</p>}

      {editError && <p className={styles.errorBanner}>{editError}</p>}

      <ul className={styles.shiftList}>
        {effectiveShifts.length === 0 && !busy ? (
          <li className={styles.emptyRow}>No shifts recorded for this day.</li>
        ) : (
          effectiveShifts.map((s, i) => {
            // Marks where the day changes over from one service to the next, so
            // the two blocks read as two shifts of staffing rather than one long
            // list that happens to be in time order.
            const heading = serviceHeadingAt(effectiveShifts, i);
            const original = visibleShifts.find((v) => v.id === s.id);
            const name = nameOfTeamMember(s.teamMemberId, teamMembers[s.teamMemberId]);
            const start = fmtClockTime(s.startAt);
            const end = fmtClockTime(s.endAt);
            const editRec = edits[s.id];
            const isEdited = !!editRec;
            const isSaving = savingEditId === s.id;
            const editingStart = editingField?.shiftId === s.id && editingField.field === "start";
            const editingEnd = editingField?.shiftId === s.id && editingField.field === "end";

            return (
              <Fragment key={s.id}>
              {heading && (
                <li className={styles.serviceHeading} role="presentation">
                  {heading}
                </li>
              )}
              <li className={styles.shiftCard}>
                <span className={styles.avatar} aria-hidden="true">{initials(name)}</span>
                <div className={styles.shiftBody}>
                  <p className={styles.shiftName}>{name}</p>
                  <div className={styles.timeRow}>
                    {editingStart ? (
                      <input
                        type="time"
                        step={ROUNDING_STEP_SECONDS}
                        className={styles.timeInput}
                        defaultValue={s.startAt.slice(11, 16)}
                        autoFocus
                        disabled={isSaving}
                        onBlur={(e) => {
                          const v = e.currentTarget.value;
                          if (v && v !== s.startAt.slice(11, 16)) void saveTimeEdit(s, "start", v);
                          else setEditingField(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                          if (e.key === "Escape") setEditingField(null);
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className={styles.timeChip}
                        onClick={() => setEditingField({ shiftId: s.id, field: "start" })}
                        aria-label="Edit start time"
                      >
                        <span className={styles.timeChipMain}>{start.hhmm}</span>
                        <span className={styles.timeChipAmpm}>{start.ampm}</span>
                      </button>
                    )}
                    <span className={styles.timeSep}>—</span>
                    {editingEnd ? (
                      <input
                        type="time"
                        step={ROUNDING_STEP_SECONDS}
                        className={styles.timeInput}
                        defaultValue={s.endAt ? s.endAt.slice(11, 16) : ""}
                        autoFocus
                        disabled={isSaving}
                        onBlur={(e) => {
                          const v = e.currentTarget.value;
                          if (v && (!s.endAt || v !== s.endAt.slice(11, 16))) void saveTimeEdit(s, "end", v);
                          else setEditingField(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                          if (e.key === "Escape") setEditingField(null);
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className={styles.timeChip}
                        onClick={() => setEditingField({ shiftId: s.id, field: "end" })}
                        aria-label="Edit end time"
                      >
                        <span className={styles.timeChipMain}>{end.hhmm}</span>
                        <span className={styles.timeChipAmpm}>{end.ampm}</span>
                      </button>
                    )}
                  </div>
                  {isEdited && original ? (
                    <p className={styles.editedNote}>
                      <span className={styles.editedBadge}>EDITED</span>
                      <span className={styles.editedWas}>
                        {" "}· was {(() => {
                        const os = fmtClockTime(editRec.originalStartAt || original.startAt);
                        const oe = fmtClockTime(editRec.originalEndAt || original.endAt);
                        return `${os.hhmm} ${os.ampm} – ${oe.hhmm} ${oe.ampm}`;
                      })()}
                      </span>
                    </p>
                  ) : (
                    <p className={styles.editNote}>No edits{isSaving ? " · saving…" : ""}</p>
                  )}
                </div>
                <span className={styles.hoursBadge}>{fmtHours(s.hours)}</span>
                <button
                  type="button"
                  className={styles.deleteBtn}
                  aria-label={`Remove ${name}'s shift`}
                  onClick={() => void removeShift(s)}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </li>
              </Fragment>
            );
          })
        )}
      </ul>

      <button
        type="button"
        className={styles.addShiftBtn}
        onClick={() => { setAddError(null); setAddOpen(true); }}
      >
        <span aria-hidden="true">+</span> Add shift
      </button>

      <div className={styles.footNote}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        Hours shown are paid hours. Breaks are excluded.
      </div>

      {addOpen && (
        <div
          className={styles.modalBackdrop}
          onClick={(e) => { if (e.target === e.currentTarget) setAddOpen(false); }}
          role="dialog"
          aria-modal="true"
          aria-label="Add shift"
        >
          <div className={styles.modal}>
            <div className={styles.modalHead}>
              <div>
                <h2 className={styles.modalTitle}>Add shift</h2>
                <p className={styles.modalSub}>Back-fill a missed clock-in / clock-out. Saved in-app only, not pushed to Square.</p>
              </div>
              <button
                type="button"
                className={styles.modalClose}
                aria-label="Close"
                onClick={() => setAddOpen(false)}
              >×</button>
            </div>

            <label className={styles.formLabel}>Staff</label>
            <select
              className={styles.formInput}
              value={addForm.teamMemberId}
              onChange={(e) => setAddForm((p) => ({ ...p, teamMemberId: e.target.value }))}
              disabled={savingAdd}
            >
              <option value="">Select a staff member…</option>
              {Object.entries(teamMembers)
                .map(([id, tm]) => ({ id, name: nameOfTeamMember(id, tm) }))
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(({ id, name }) => (
                  <option key={id} value={id}>{name}</option>
                ))}
            </select>

            <label className={styles.formLabel}>Date</label>
            <input
              className={styles.formInput}
              type="date"
              value={dateISO}
              readOnly
              disabled
            />

            <div className={styles.formGrid2}>
              <div>
                <label className={styles.formLabel}>Start (HH:MM)</label>
                <input
                  className={styles.formInput}
                  type="time"
                  step={ROUNDING_STEP_SECONDS}
                  value={addForm.startHHMM}
                  onChange={(e) => setAddForm((p) => ({ ...p, startHHMM: e.target.value }))}
                  disabled={savingAdd}
                />
              </div>
              <div>
                <label className={styles.formLabel}>End (HH:MM)</label>
                <input
                  className={styles.formInput}
                  type="time"
                  step={ROUNDING_STEP_SECONDS}
                  value={addForm.endHHMM}
                  onChange={(e) => setAddForm((p) => ({ ...p, endHHMM: e.target.value }))}
                  disabled={savingAdd}
                />
              </div>
            </div>

            {addError && <p className={styles.modalError}>{addError}</p>}

            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.modalCancelBtn}
                onClick={() => setAddOpen(false)}
                disabled={savingAdd}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.modalPrimaryBtn}
                onClick={() => void submitAddShift()}
                disabled={savingAdd || !addForm.teamMemberId}
              >
                <span aria-hidden="true">+</span> {savingAdd ? "Saving…" : "Add shift"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
