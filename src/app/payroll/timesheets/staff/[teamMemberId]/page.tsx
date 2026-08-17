"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { isOwner } from "@/lib/permissions";
import { dismissSquareShift } from "@/lib/timesheet-dismiss-client";
import {
  ROUNDING_MINUTES,
  ROUNDING_STEP_SECONDS,
  snapClockWindow,
} from "@/lib/timesheet-rounding";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

/*
 * Staff drill-down — Square is read-only; edits/backfills live in Firestore.
 * Layout: date filter, staff sidebar (expanded selected), shift cards panel.
 */

const SYDNEY_TZ = "Australia/Sydney";

type ShiftFromApi = {
  id: string;
  teamMemberId: string;
  dateISO: string;
  startAt: string;
  endAt: string | null;
  hours: number;
  hourlyRateCents: number | null;
  /** Raw clock record behind the paid window; null for owner backfills. */
  clockedStartAt?: string | null;
  clockedEndAt?: string | null;
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
type StaffRow = {
  teamMemberId: string;
  name: string;
  shifts: number;
  hours: number;
  gross: number;
};
type ShiftDraft = { startHHMM: string; endHHMM: string };

function sydneyTodayISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: SYDNEY_TZ });
}
function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
function eachDayISO(startISO: string, endISO: string): string[] {
  const out: string[] = [];
  let cur = startISO;
  while (cur <= endISO) {
    out.push(cur);
    cur = addDaysISO(cur, 1);
  }
  return out;
}
function fmtDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-AU", {
    weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
  });
}
function fmtClock(iso: string | null): { hhmm: string; ampm: string } {
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
function hhmmFromIso(iso: string | null): string {
  return iso ? iso.slice(11, 16) : "";
}
function fmtHoursShort(h: number): string {
  return `${h.toFixed(2)}h`;
}
function fmtHoursLong(h: number): string {
  return `${h.toFixed(2)} hrs`;
}
function fmtMoney(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtRate(n: number): string {
  return `$${n.toFixed(2)}`;
}
function nameOfMember(id: string, tm: TeamMemberFromApi | undefined): string {
  const f = (tm?.firstName ?? "").trim();
  const l = (tm?.lastName ?? "").trim();
  return f || l ? `${f}${l ? " " + l : ""}` : id.slice(0, 6);
}
function replaceHHMM(iso: string, hhmm: string): string {
  return iso.slice(0, 11) + hhmm + iso.slice(16);
}
function hoursFromIso(startAt: string, endAt: string | null): number {
  if (!endAt) return 0;
  const h = Math.round(((new Date(endAt).getTime() - new Date(startAt).getTime()) / 3_600_000) * 100) / 100;
  return h > 0 ? h : 0;
}
/*
 * Every paid window is the end of a short chain: the employee clocked, the
 * app snapped that to the quarter-hour grid, and sometimes an owner corrected
 * it afterwards. The card shows the chain so a figure can always be traced
 * back to the clock, with each step attributed to whoever moved it.
 *
 * The clock record is held apart from the adjustments rather than sitting at
 * the top of the same list. It is the one line nobody in the office typed —
 * the employee's own record, and the thing an argument about a timesheet
 * ultimately appeals to — so it reads as evidence rather than as step one of
 * a calculation.
 */
const AUTO_AUTHOR = "AI";
const OWNER_AUTHOR = "Yurica";

/** Every adjustment has someone behind it — the app or the owner. The clock
 *  record, which has neither, is kept separately. */
type Adjustment = { label: string; range: string; author: string };

type ClockTrail = {
  /** What the employee's own clock-in/out recorded, untouched. Null for a
   *  shift that never went through the clock — an owner backfill. */
  clocked: string | null;
  /** Everything applied to that record since, oldest first. */
  adjustments: Adjustment[];
};

function clockRange(startAt: string | null, endAt: string | null): string {
  const s = fmtClock(startAt);
  const e = fmtClock(endAt);
  const one = (c: { hhmm: string; ampm: string }) =>
    c.ampm ? `${c.hhmm} ${c.ampm}` : c.hhmm;
  return `${one(s)} – ${one(e)}`;
}

function sameWindow(
  a: { start: string | null; end: string | null },
  b: { start: string | null; end: string | null },
): boolean {
  return a.start === b.start && a.end === b.end;
}

/**
 * Rebuilt rather than stored: the clock record, the snap and the edit are all
 * kept, so replaying them beats keeping a fourth copy that could drift from
 * the three.
 */
function clockTrailFor(s: ShiftFromApi, edit: EditDoc | undefined): ClockTrail {
  // A shift edited before we started keeping clock records still has its
  // originals on the edit doc.
  const clockedStart = s.clockedStartAt ?? edit?.originalStartAt ?? null;
  const clockedEnd = s.clockedEndAt ?? edit?.originalEndAt ?? null;

  const adjustments: Adjustment[] = [];
  if (!clockedStart) {
    if (edit?.startAt) {
      adjustments.push({
        label: "Edited",
        range: clockRange(edit.startAt, edit.endAt),
        author: OWNER_AUTHOR,
      });
    }
    return { clocked: null, adjustments };
  }

  const snapped = snapClockWindow(clockedStart, clockedEnd);
  const clocked = { start: clockedStart, end: clockedEnd };
  const paid = { start: snapped.startAt, end: snapped.endAt };
  if (!sameWindow(clocked, paid)) {
    adjustments.push({
      label: `Rounded to ${ROUNDING_MINUTES} min`,
      range: clockRange(snapped.startAt, snapped.endAt),
      author: AUTO_AUTHOR,
    });
  }

  if (edit?.startAt && !sameWindow(paid, { start: edit.startAt, end: edit.endAt })) {
    adjustments.push({
      label: "Edited",
      range: clockRange(edit.startAt, edit.endAt),
      author: OWNER_AUTHOR,
    });
  }

  return { clocked: clockRange(clockedStart, clockedEnd), adjustments };
}

function applyEditToShift(s: ShiftFromApi, edit: EditDoc | undefined): ShiftFromApi {
  if (!edit?.startAt || !edit?.endAt) return s;
  return {
    ...s,
    startAt: edit.startAt,
    endAt: edit.endAt,
    hours: hoursFromIso(edit.startAt, edit.endAt),
  };
}
function memberRates(shifts: ShiftFromApi[]): { weekday: number | null; saturday: number | null } {
  let weekday: number | null = null;
  let saturday: number | null = null;
  for (const s of shifts) {
    if (s.hourlyRateCents == null) continue;
    const rate = s.hourlyRateCents / 100;
    const [y, m, d] = s.dateISO.split("-").map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
    if (dow === 6) saturday = rate;
    else if (weekday == null) weekday = rate;
  }
  return { weekday, saturday };
}

function useSplitStaffLayout(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const mq = window.matchMedia("(min-width: 768px)");
      mq.addEventListener("change", onStoreChange);
      return () => mq.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia("(min-width: 768px)").matches,
    () => false,
  );
}

export default function StaffDetailPage() {
  const router = useRouter();
  const params = useParams<{ teamMemberId: string }>();
  const searchParams = useSearchParams();
  const teamMemberId = decodeURIComponent(params?.teamMemberId ?? "");

  const { user, loading: authLoading } = useAuth();
  const allowed = isOwner(user);
  const splitLayout = useSplitStaffLayout();

  const [startISO, setStartISO] = useState("");
  const [endISO, setEndISO] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [shifts, setShifts] = useState<ShiftFromApi[]>([]);
  const [teamMembers, setTeamMembers] = useState<Record<string, TeamMemberFromApi>>({});
  const [edits, setEdits] = useState<Record<string, EditDoc>>({});
  const [extraIds, setExtraIds] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, ShiftDraft>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const dirtyRef = useRef<Set<string>>(new Set());
  const [editingField, setEditingField] = useState<{ shiftId: string; field: "start" | "end" } | null>(null);
  const [savingEditId, setSavingEditId] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ dateISO: "", startHHMM: "10:00", endHHMM: "14:30" });
  const [savingAdd, setSavingAdd] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    const qStart = searchParams?.get("start") ?? "";
    const qEnd = searchParams?.get("end") ?? "";
    if (qStart && qEnd) {
      setStartISO(qStart);
      setEndISO(qEnd);
    } else {
      setStartISO(addDaysISO(sydneyTodayISO(), -6));
      setEndISO(sydneyTodayISO());
    }
  }, [searchParams]);

  /** `fresh` skips the server's short Square cache, so a reload that follows
   *  a write can't hand back the numbers from before it. */
  const load = useCallback(async (opts?: { fresh?: boolean }) => {
    if (!startISO || !endISO) return;
    setBusy(true);
    setFetchError(null);
    try {
      const res = await fetch(
        `/api/payroll/timesheets?startDate=${encodeURIComponent(startISO)}&endDate=${encodeURIComponent(endISO)}${opts?.fresh ? "&fresh=1" : ""}`,
        { cache: "no-store" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Fetch failed");
      setShifts(Array.isArray(data.shifts) ? (data.shifts as ShiftFromApi[]) : []);
      setTeamMembers(
        data.teamMembers && typeof data.teamMembers === "object"
          ? (data.teamMembers as Record<string, TeamMemberFromApi>)
          : {},
      );

      const [eSnap, xSnap] = await Promise.all([
        getDocs(
          query(
            collection(getDb(), "timesheet_edits"),
            where("dateISO", ">=", startISO),
            where("dateISO", "<=", endISO),
          ),
        ),
        getDocs(
          query(
            collection(getDb(), "timesheet_extra_shifts"),
            where("dateISO", ">=", startISO),
            where("dateISO", "<=", endISO),
          ),
        ),
      ]);
      const editMap: Record<string, EditDoc> = {};
      for (const d of eSnap.docs) {
        editMap[d.id] = { shiftId: d.id, ...(d.data() as Omit<EditDoc, "shiftId">) };
      }
      setEdits(editMap);
      setExtraIds(new Set(xSnap.docs.map((d) => d.id)));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Timesheet fetch failed.";
      console.error("[staff-detail] fetch failed:", err);
      setFetchError(msg);
      setShifts([]);
      setTeamMembers({});
      setEdits({});
      setExtraIds(new Set());
    } finally {
      setBusy(false);
      setLoading(false);
    }
  }, [startISO, endISO]);

  useEffect(() => {
    if (authLoading || !allowed || !startISO || !endISO) return;
    void load();
  }, [authLoading, allowed, load, startISO, endISO]);

  const byStaff = useMemo(() => {
    const agg: Record<string, StaffRow> = {};
    for (const s of shifts) {
      if (dismissed.has(s.id)) continue;
      const rate = typeof s.hourlyRateCents === "number" ? s.hourlyRateCents / 100 : 0;
      const row = (agg[s.teamMemberId] ??= {
        teamMemberId: s.teamMemberId,
        name: nameOfMember(s.teamMemberId, teamMembers[s.teamMemberId]),
        shifts: 0,
        hours: 0,
        gross: 0,
      });
      row.shifts += 1;
      row.hours += s.hours;
      row.gross += s.hours * rate;
    }
    return Object.values(agg).sort((a, b) => a.name.localeCompare(b.name, "en-AU"));
  }, [shifts, teamMembers, dismissed]);

  const memberShifts = useMemo(
    () =>
      shifts
        .filter((s) => s.teamMemberId === teamMemberId && !dismissed.has(s.id))
        .map((s) => applyEditToShift(s, edits[s.id]))
        .sort((a, b) => a.startAt.localeCompare(b.startAt)),
    [shifts, teamMemberId, dismissed, edits],
  );

  useEffect(() => {
    setDrafts((prev) => {
      const next: Record<string, ShiftDraft> = {};
      for (const s of memberShifts) {
        if (dirtyRef.current.has(s.id) && prev[s.id]) {
          next[s.id] = prev[s.id];
        } else {
          next[s.id] = { startHHMM: hhmmFromIso(s.startAt), endHHMM: hhmmFromIso(s.endAt) };
        }
      }
      return next;
    });
  }, [memberShifts]);

  const dayCount = startISO && endISO ? eachDayISO(startISO, endISO).length : 0;

  function updateDraft(shiftId: string, patch: Partial<ShiftDraft>) {
    setDrafts((prev) => ({ ...prev, [shiftId]: { ...prev[shiftId], ...patch } }));
    dirtyRef.current = new Set(dirtyRef.current).add(shiftId);
    setDirty(dirtyRef.current);
  }

  function draftHours(shift: ShiftFromApi): number {
    const d = drafts[shift.id];
    if (!d?.startHHMM || !d.endHHMM) return shift.hours;
    const startAt = replaceHHMM(shift.startAt, d.startHHMM);
    const endAt = replaceHHMM(shift.endAt ?? shift.startAt, d.endHHMM);
    return hoursFromIso(startAt, endAt);
  }

  async function saveShift(shift: ShiftFromApi) {
    if (!user) return;
    const d = drafts[shift.id];
    if (!d || !/^\d{2}:\d{2}$/.test(d.startHHMM) || !/^\d{2}:\d{2}$/.test(d.endHHMM)) return;

    const existing = edits[shift.id];
    const base = shifts.find((x) => x.id === shift.id) ?? shift;
    const newStart = replaceHHMM(existing?.startAt ?? base.startAt, d.startHHMM);
    const newEnd = replaceHHMM(existing?.endAt ?? base.endAt ?? base.startAt, d.endHHMM);
    const patch: EditDoc = {
      shiftId: shift.id,
      dateISO: shift.dateISO,
      // "was" has to mean what the clock said, not the snapped window we
      // showed on top of it.
      originalStartAt: existing?.originalStartAt ?? base.clockedStartAt ?? base.startAt,
      originalEndAt: existing?.originalEndAt ?? base.clockedEndAt ?? base.endAt,
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
      setShifts((prev) =>
        prev.map((s) =>
          s.id === shift.id
            ? {
                ...s,
                startAt: patch.startAt,
                endAt: patch.endAt,
                hours: hoursFromIso(patch.startAt, patch.endAt),
              }
            : s,
        ),
      );
      setDirty((prev) => {
        const next = new Set(prev);
        next.delete(shift.id);
        dirtyRef.current = next;
        return next;
      });
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
        void load({ fresh: true });
      } catch (err) {
        console.error("[timesheet_extra_shifts] delete failed:", err);
        setEditError(err instanceof Error ? err.message : "Delete failed.");
      }
      return;
    }
    try {
      await dismissSquareShift(shift, user.uid);
      setDismissed((prev) => new Set(prev).add(shift.id));
      void load({ fresh: true });
    } catch (err) {
      console.error("[timesheet_dismissed] save failed:", err);
      setEditError(err instanceof Error ? err.message : "Delete failed.");
    }
  }

  function applyRange() {
    router.replace(
      `/payroll/timesheets/staff/${encodeURIComponent(teamMemberId)}?start=${startISO}&end=${endISO}`,
    );
    void load();
  }

  function shiftsForStaff(staffId: string): ShiftFromApi[] {
    return shifts
      .filter((s) => s.teamMemberId === staffId && !dismissed.has(s.id))
      .map((s) => applyEditToShift(s, edits[s.id]))
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
  }

  function renderShiftsBlock(staffShifts: ShiftFromApi[], className?: string) {
    return (
      <div className={className}>
        <h2 className={styles.shiftsHeading}>Shifts ({staffShifts.length})</h2>
        <ul className={styles.shiftList}>
          {staffShifts.length === 0 && !busy && (
            <li className={styles.empty}>No shifts recorded in this range.</li>
          )}
          {staffShifts.map((s) => {
            const draft = drafts[s.id] ?? {
              startHHMM: hhmmFromIso(s.startAt),
              endHHMM: hhmmFromIso(s.endAt),
            };
            const editRec = edits[s.id];
            const { clocked, adjustments } = clockTrailFor(s, editRec);
            // An edit that lands where the automatic snap already put it
            // changed nothing, so it doesn't earn the badge.
            const isEdited = adjustments.some((a) => a.author === OWNER_AUTHOR);
            const isSaving = savingEditId === s.id;
            const isDirty = dirty.has(s.id);
            const editingStart = editingField?.shiftId === s.id && editingField.field === "start";
            const editingEnd = editingField?.shiftId === s.id && editingField.field === "end";

            const displayStart = replaceHHMM(s.startAt, draft.startHHMM || hhmmFromIso(s.startAt));
            const displayEnd = s.endAt
              ? replaceHHMM(s.endAt, draft.endHHMM || hhmmFromIso(s.endAt))
              : null;
            const start = fmtClock(displayStart);
            const end = fmtClock(displayEnd);

            return (
              <li key={s.id} className={styles.shiftCard}>
                <p className={styles.shiftDate}>{fmtDay(s.dateISO)}</p>
                <div className={styles.timeRow}>
                  {editingStart ? (
                    <input
                      type="time"
                      className={styles.timeInput}
                      value={draft.startHHMM}
                      step={ROUNDING_STEP_SECONDS}
                      autoFocus
                      disabled={isSaving}
                      onChange={(e) => updateDraft(s.id, { startHHMM: e.target.value })}
                      onBlur={() => setEditingField(null)}
                    />
                  ) : (
                    <button
                      type="button"
                      className={styles.timeChip}
                      onClick={() => setEditingField({ shiftId: s.id, field: "start" })}
                    >
                      <span className={styles.timeMain}>{start.hhmm}</span>
                      <span className={styles.timeAmpm}>{start.ampm}</span>
                    </button>
                  )}
                  <span className={styles.timeSep}>—</span>
                  {editingEnd ? (
                    <input
                      type="time"
                      className={styles.timeInput}
                      value={draft.endHHMM}
                      step={ROUNDING_STEP_SECONDS}
                      autoFocus
                      disabled={isSaving}
                      onChange={(e) => updateDraft(s.id, { endHHMM: e.target.value })}
                      onBlur={() => setEditingField(null)}
                    />
                  ) : (
                    <button
                      type="button"
                      className={styles.timeChip}
                      onClick={() => setEditingField({ shiftId: s.id, field: "end" })}
                    >
                      <span className={styles.timeMain}>{end.hhmm}</span>
                      <span className={styles.timeAmpm}>{end.ampm}</span>
                    </button>
                  )}
                </div>
                {isEdited && <span className={styles.editedBadge}>EDITED</span>}
                {adjustments.length > 0 && (
                  <ol className={styles.trail}>
                    {adjustments.map((a) => (
                      <li key={a.label} className={styles.trailRow}>
                        <span className={styles.trailRange}>{a.range}</span>
                        <span className={styles.trailLabel}>{a.label}</span>
                        <span className={styles.trailAuthor}>by {a.author}</span>
                      </li>
                    ))}
                  </ol>
                )}
                {clocked && (
                  <p className={styles.clockedRow}>
                    <span className={styles.clockedRange}>{clocked}</span>
                    <span className={styles.clockedLabel}>Clocked by staff</span>
                  </p>
                )}
                <p className={styles.storeNote}>
                  Store time (Australia/Sydney) · paid in {ROUNDING_MINUTES}-minute steps
                </p>
                <div className={styles.shiftFooter}>
                  <span className={styles.shiftHours}>{fmtHoursLong(draftHours(s))}</span>
                  <div className={styles.shiftActions}>
                    <button
                      type="button"
                      className={styles.saveBtn}
                      disabled={!isDirty || isSaving}
                      onClick={() => void saveShift(s)}
                    >
                      {isSaving ? "…" : "Save"}
                    </button>
                    <button
                      type="button"
                      className={styles.deleteBtn}
                      aria-label="Remove shift"
                      onClick={() => void removeShift(s)}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  if (authLoading || loading) return <Splash />;
  if (!allowed) return <div className={styles.page}><p>Owner access only.</p></div>;

  return (
    <div className={styles.page}>
      <p className={styles.sectionLabel}>DATE RANGE</p>
      <section className={styles.filterCard}>
        <div className={styles.rangeGrid}>
          <div className={styles.rangeField}>
            <span className={styles.rangeLabel}>Start</span>
            <input
              type="date"
              className={styles.dateInput}
              value={startISO}
              onChange={(e) => setStartISO(e.target.value)}
            />
          </div>
          <div className={styles.rangeField}>
            <span className={styles.rangeLabel}>End</span>
            <input
              type="date"
              className={styles.dateInput}
              value={endISO}
              min={startISO || undefined}
              onChange={(e) => setEndISO(e.target.value)}
            />
          </div>
          <button
            type="button"
            className={styles.applyBtn}
            onClick={applyRange}
            disabled={busy || !startISO || !endISO || startISO > endISO}
          >
            {busy ? "…" : "Apply"}
          </button>
        </div>
      </section>

      <div className={styles.listSectionHead}>
        <div>
          <p className={styles.sectionLabel}>BY STAFF</p>
          <p className={styles.listSectionMeta}>
            {startISO} ~ {endISO} · {dayCount}
          </p>
        </div>
        <div className={styles.actionRow}>
          <div className={styles.viewToggle} role="tablist" aria-label="View mode">
            <Link href="/payroll/timesheets" className={styles.toggleBtn} role="tab">
              Day
            </Link>
            <span className={`${styles.toggleBtn} ${styles.toggleBtnActive}`} role="tab" aria-selected>
              Staff
            </span>
          </div>
          <button
            type="button"
            className={styles.clearBtn}
            onClick={() => router.push("/payroll/timesheets")}
          >
            &lt; Clear
          </button>
          <button
            type="button"
            className={styles.addShiftBtn}
            onClick={() => {
              setAddError(null);
              setAddForm((p) => ({ ...p, dateISO: startISO || endISO || "" }));
              setAddOpen(true);
            }}
          >
            + Add shift
          </button>
          <button type="button" className={styles.refreshBtn} onClick={() => void load({ fresh: true })} disabled={busy}>
            <RefreshIcon /> Refresh
          </button>
        </div>
      </div>

      {fetchError && <p className={styles.errorBanner}>{fetchError}</p>}
      {editError && <p className={styles.errorBanner}>{editError}</p>}

      <div className={styles.splitLayout}>
        <ul className={styles.staffSidebar}>
          {byStaff.map((staff) => {
            const selected = staff.teamMemberId === teamMemberId;
            const staffRates = memberRates(
              shifts.filter((s) => s.teamMemberId === staff.teamMemberId && !dismissed.has(s.id)),
            );

            if (selected) {
              return (
                <li key={staff.teamMemberId} className={`${styles.staffSidebarItem} ${styles.staffSidebarItemExpanded}`}>
                  <div className={styles.staffRowBtn}>
                    <div className={styles.rowBody}>
                      <div className={styles.rowTitleLine}>
                        <p className={styles.rowTitle}>{staff.name}</p>
                        <span className={styles.hoursPill}>{fmtHoursShort(staff.hours)}</span>
                      </div>
                      <p className={styles.rowMeta}>
                        {staff.shifts} shifts · {fmtMoney(staff.gross)}
                      </p>
                    </div>
                    <span className={`${styles.rowChev} ${styles.rowChevDown}`} aria-hidden="true">›</span>
                  </div>
                  <div className={styles.staffDetailCard}>
                    <p className={styles.detailName}>{staff.name}</p>
                    <p className={styles.detailHours}>{fmtHoursShort(staff.hours)}</p>
                    <p className={styles.detailRates}>
                      {staffRates.weekday != null ? fmtRate(staffRates.weekday) : "—"} (weekday)
                      {" / "}
                      {staffRates.saturday != null ? fmtRate(staffRates.saturday) : "—"} (Sat)
                    </p>
                    <p className={styles.detailGrossLabel}>Est. gross pay</p>
                    <p className={styles.detailGross}>{fmtMoney(staff.gross)}</p>
                    {staffRates.weekday == null && staffRates.saturday == null && (
                      /* Without a rate the estimate is $0.00, which reads as
                         "worked for nothing" rather than "we don't know yet". */
                      <p className={styles.detailRateMissing}>
                        No rate set on this employee&rsquo;s profile — these hours are unpriced.
                      </p>
                    )}
                  </div>
                  {!splitLayout &&
                    renderShiftsBlock(shiftsForStaff(staff.teamMemberId), styles.inlineShifts)}
                </li>
              );
            }

            return (
              <li key={staff.teamMemberId} className={styles.staffSidebarItem}>
                <Link
                  href={`/payroll/timesheets/staff/${encodeURIComponent(staff.teamMemberId)}?start=${startISO}&end=${endISO}`}
                  className={styles.staffRowLink}
                >
                  <div className={styles.rowBody}>
                    <div className={styles.rowTitleLine}>
                      <p className={styles.rowTitle}>{staff.name}</p>
                      <span className={styles.hoursPill}>{fmtHoursShort(staff.hours)}</span>
                    </div>
                    <p className={styles.rowMeta}>
                      {staff.shifts} shifts · {fmtMoney(staff.gross)}
                    </p>
                  </div>
                  <span className={styles.rowChev} aria-hidden="true">›</span>
                </Link>
              </li>
            );
          })}
          {byStaff.length === 0 && <li className={styles.empty}>No staff in this range.</li>}
        </ul>

        {splitLayout && (
          <section className={styles.shiftsPanelDesktop}>
            {renderShiftsBlock(memberShifts)}
          </section>
        )}
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
                <p className={styles.modalSub}>Saved on our server only — not sent to Square.</p>
              </div>
              <button type="button" className={styles.modalClose} onClick={() => setAddOpen(false)} aria-label="Close">×</button>
            </div>
            <label className={styles.formLabel}>Date</label>
            <input
              className={styles.formInput}
              type="date"
              value={addForm.dateISO}
              onChange={(e) => setAddForm((p) => ({ ...p, dateISO: e.target.value }))}
              disabled={savingAdd}
              min={startISO || undefined}
              max={endISO || undefined}
            />
            <div className={styles.formGrid2}>
              <div>
                <label className={styles.formLabel}>Start</label>
                <input
                  className={styles.formInput}
                  type="time"
                  value={addForm.startHHMM}
                  step={ROUNDING_STEP_SECONDS}
                  onChange={(e) => setAddForm((p) => ({ ...p, startHHMM: e.target.value }))}
                  disabled={savingAdd}
                />
              </div>
              <div>
                <label className={styles.formLabel}>End</label>
                <input
                  className={styles.formInput}
                  type="time"
                  value={addForm.endHHMM}
                  step={ROUNDING_STEP_SECONDS}
                  onChange={(e) => setAddForm((p) => ({ ...p, endHHMM: e.target.value }))}
                  disabled={savingAdd}
                />
              </div>
            </div>
            {addError && <p className={styles.modalError}>{addError}</p>}
            <div className={styles.modalActions}>
              <button type="button" className={styles.modalCancelBtn} onClick={() => setAddOpen(false)} disabled={savingAdd}>
                Cancel
              </button>
              <button
                type="button"
                className={styles.modalPrimaryBtn}
                disabled={savingAdd}
                onClick={async () => {
                  if (!user) return;
                  if (!addForm.dateISO) { setAddError("Pick a date."); return; }
                  if (!/^\d{2}:\d{2}$/.test(addForm.startHHMM) || !/^\d{2}:\d{2}$/.test(addForm.endHHMM)) {
                    setAddError("Enter times in HH:MM format.");
                    return;
                  }
                  const dayShift = shifts.find((x) => x.dateISO === addForm.dateISO);
                  const offMatch = dayShift ? /([+-]\d{2}:\d{2})$/.exec(dayShift.startAt) : null;
                  const offset = offMatch ? offMatch[1] : "+10:00";
                  const startAt = `${addForm.dateISO}T${addForm.startHHMM}:00${offset}`;
                  const endAt = `${addForm.dateISO}T${addForm.endHHMM}:00${offset}`;
                  const hours = hoursFromIso(startAt, endAt);
                  if (hours <= 0) { setAddError("End time must be after start time."); return; }
                  setSavingAdd(true);
                  setAddError(null);
                  try {
                    await addDoc(collection(getDb(), "timesheet_extra_shifts"), {
                      teamMemberId,
                      dateISO: addForm.dateISO,
                      startAt,
                      endAt,
                      hours,
                      hourlyRateCents: null,
                      source: "app-local",
                      createdAt: serverTimestamp(),
                      createdBy: user.uid,
                    });
                    setAddOpen(false);
                    setAddForm({ dateISO: "", startHHMM: "10:00", endHHMM: "14:30" });
                    void load({ fresh: true });
                  } catch (err) {
                    console.error("[timesheet_extra_shifts] add failed:", err);
                    setAddError(err instanceof Error ? err.message : "Save failed.");
                  } finally {
                    setSavingAdd(false);
                  }
                }}
              >
                {savingAdd ? "Saving…" : "Add shift"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}
