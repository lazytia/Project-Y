"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { addDoc, collection, doc, getDocs, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { isOwner } from "@/lib/permissions";
import Splash from "@/components/Splash";
import CalendarPicker from "@/components/CalendarPicker";
import styles from "./page.module.css";

/*
 * Day Details — drill-down from /payroll/timesheets showing every Square
 * Labor shift recorded for a single calendar day. Read-only for now;
 * "Add shift" is a stub, delete is a placeholder that only clears the
 * row from the local view. The intention is that Square Labor stays
 * the authoritative record and this page mirrors it.
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
 * A per-shift override document stored in Firestore. We NEVER push these
 * values back to Square — Square Labor stays authoritative for the
 * underlying record. This just lets the owner tidy up the local view.
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
        const snap = await getDocs(
          query(collection(getDb(), "timesheet_extra_shifts"), where("dateISO", "==", dateISO)),
        );
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
      } catch (err) {
        console.warn("[day-details] extra shifts fetch failed:", err);
        setExtraShifts([]);
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
    return merged
      .filter((s) => s.dateISO === dateISO && !dismissed.has(s.id))
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
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
    let hours = s.hours;
    if (startAt && endAt) {
      hours = Math.round(((new Date(endAt).getTime() - new Date(startAt).getTime()) / 3_600_000) * 100) / 100;
      if (hours < 0) hours = 0;
    }
    return { ...s, startAt, endAt, hours };
  }

  const effectiveShifts = useMemo(() => visibleShifts.map(withEdit), [visibleShifts, edits]);
  const totalHours = useMemo(
    () => effectiveShifts.reduce((sum, s) => sum + s.hours, 0),
    [effectiveShifts],
  );

  /**
   * Replace the HH:MM portion of a Square-returned ISO like
   * "2026-06-29T10:01:00+10:00" with a new "HH:MM" from an <input type="time">.
   * Preserves date and TZ offset so the resulting instant is unambiguous.
   */
  function replaceHHMM(iso: string, hhmm: string): string {
    return iso.slice(0, 11) + hhmm + iso.slice(16);
  }

  /** Grab the +HH:MM offset off an existing Square shift for this day so
   *  new backfill entries share the same local-time semantics. Falls back
   *  to Sydney standard time (+10:00) when there are none. */
  function localOffsetOfDay(): string {
    const first = shifts[0];
    if (first?.startAt) {
      const match = /([+-]\d{2}:\d{2})$/.exec(first.startAt);
      if (match) return match[1];
    }
    return "+10:00";
  }

  async function submitAddShift() {
    if (!user) return;
    if (!addForm.teamMemberId) { setAddError("Pick a staff member."); return; }
    if (!/^\d{2}:\d{2}$/.test(addForm.startHHMM) || !/^\d{2}:\d{2}$/.test(addForm.endHHMM)) {
      setAddError("Enter times in HH:MM format.");
      return;
    }
    const offset = localOffsetOfDay();
    const startAt = `${dateISO}T${addForm.startHHMM}:00${offset}`;
    const endAt = `${dateISO}T${addForm.endHHMM}:00${offset}`;
    const hours = Math.round(
      ((new Date(endAt).getTime() - new Date(startAt).getTime()) / 3_600_000) * 100,
    ) / 100;
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
    const newStart = field === "start" ? replaceHHMM(currentStart, newHHMM) : currentStart;
    const newEnd =
      field === "end" && currentEnd ? replaceHHMM(currentEnd, newHHMM) : currentEnd;

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
          effectiveShifts.map((s) => {
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
              <li key={s.id} className={styles.shiftCard}>
                <span className={styles.avatar} aria-hidden="true">{initials(name)}</span>
                <div className={styles.shiftBody}>
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
                  onClick={() => setDismissed((prev) => new Set(prev).add(s.id))}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </li>
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
