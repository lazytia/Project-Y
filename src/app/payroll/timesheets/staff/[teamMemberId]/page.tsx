"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { collection, doc, getDocs, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { isOwner } from "@/lib/permissions";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

/*
 * Per-staff drill-down. Reachable from /payroll/timesheets Staff view.
 * Shows this team member's Square Labor shifts across the selected
 * range + any local edits/extras. Time edits stay in Firestore only —
 * Square is never mutated.
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

/* ── helpers ─────────────────────────────────────────────────────── */

function sydneyTodayISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: SYDNEY_TZ });
}
function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
function isoMondayOf(dateISO: string): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - dow);
  return dt.toISOString().slice(0, 10);
}
function fmtDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-AU", {
    weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
  });
}
function fmtRangeSubtitle(startISO: string, endISO: string): string {
  const [sy, sm, sd] = startISO.split("-").map(Number);
  const [ey, em, ed] = endISO.split("-").map(Number);
  const start = new Date(Date.UTC(sy, sm - 1, sd, 12));
  const end = new Date(Date.UTC(ey, em - 1, ed, 12));
  return `${start.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })} – ${end.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`;
}
function fmtClock(iso: string | null): { hhmm: string; ampm: string } {
  if (!iso) return { hhmm: "--:--", ampm: "" };
  const t = iso.slice(11, 16);
  const [hStr, mStr] = t.split(":");
  let h = parseInt(hStr, 10);
  if (Number.isNaN(h)) return { hhmm: t, ampm: "" };
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12; if (h === 0) h = 12;
  return { hhmm: `${h}:${mStr}`, ampm };
}
function fmtHours(h: number): string { return `${h.toFixed(2)}h`; }
function fmtMoney(n: number): string { return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function nameOfMember(id: string, tm: TeamMemberFromApi | undefined): string {
  const f = (tm?.firstName ?? "").trim();
  const l = (tm?.lastName ?? "").trim();
  return (f || l) ? `${f}${l ? " " + l : ""}` : id.slice(0, 6);
}
function initialsOf(name: string): string {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "?") + (p[1]?.[0] ?? "")).toUpperCase();
}
const STAFF_COLORS = ["#e91e63", "#9c27b0", "#ff7043", "#26a69a", "#42a5f5", "#ffb300", "#ec407a", "#26c6da", "#7e57c2", "#66bb6a"];
function colorForId(id: string): string {
  let h = 0; for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return STAFF_COLORS[h % STAFF_COLORS.length];
}
function replaceHHMM(iso: string, hhmm: string): string {
  return iso.slice(0, 11) + hhmm + iso.slice(16);
}

/* ── page ────────────────────────────────────────────────────────── */

export default function StaffDetailPage() {
  const router = useRouter();
  const params = useParams<{ teamMemberId: string }>();
  const searchParams = useSearchParams();
  const teamMemberId = decodeURIComponent(params?.teamMemberId ?? "");

  const { user, loading: authLoading } = useAuth();
  const allowed = isOwner(user);

  const [startISO, setStartISO] = useState<string>("");
  const [endISO, setEndISO] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [shifts, setShifts] = useState<ShiftFromApi[]>([]);
  const [teamMembers, setTeamMembers] = useState<Record<string, TeamMemberFromApi>>({});
  const [edits, setEdits] = useState<Record<string, EditDoc>>({});
  const [extras, setExtras] = useState<ShiftFromApi[]>([]);
  const [editingField, setEditingField] = useState<{ shiftId: string; field: "start" | "end" } | null>(null);
  const [savingEditId, setSavingEditId] = useState<string | null>(null);
  const [recentlySaved, setRecentlySaved] = useState<Set<string>>(new Set());
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  // Read range from ?start=&end=, default to current Sydney week.
  useEffect(() => {
    const qStart = searchParams?.get("start") ?? "";
    const qEnd = searchParams?.get("end") ?? "";
    if (qStart && qEnd) {
      setStartISO(qStart);
      setEndISO(qEnd);
    } else {
      const t = sydneyTodayISO();
      const mon = isoMondayOf(t);
      setStartISO(mon);
      setEndISO(addDaysISO(mon, 6));
    }
  }, [searchParams]);

  const load = useCallback(async () => {
    if (!startISO || !endISO) return;
    setBusy(true);
    setFetchError(null);
    try {
      const res = await fetch(
        `/api/square/timesheets?startDate=${encodeURIComponent(startISO)}&endDate=${encodeURIComponent(endISO)}`,
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

      // Edits + extras across the range. Firestore range filter works.
      try {
        const eSnap = await getDocs(
          query(
            collection(getDb(), "timesheet_edits"),
            where("dateISO", ">=", startISO),
            where("dateISO", "<=", endISO),
          ),
        );
        const m: Record<string, EditDoc> = {};
        for (const d of eSnap.docs) m[d.id] = { shiftId: d.id, ...(d.data() as Omit<EditDoc, "shiftId">) };
        setEdits(m);
      } catch (err) {
        console.warn("[staff-detail] edits fetch failed:", err);
        setEdits({});
      }

      try {
        const xSnap = await getDocs(
          query(
            collection(getDb(), "timesheet_extra_shifts"),
            where("dateISO", ">=", startISO),
            where("dateISO", "<=", endISO),
          ),
        );
        const xs: ShiftFromApi[] = xSnap.docs.map((d) => {
          const data = d.data() as Partial<ShiftFromApi>;
          return {
            id: d.id,
            teamMemberId: data.teamMemberId ?? "",
            dateISO: data.dateISO ?? "",
            startAt: data.startAt ?? "",
            endAt: data.endAt ?? null,
            hours: typeof data.hours === "number" ? data.hours : 0,
            hourlyRateCents: typeof data.hourlyRateCents === "number" ? data.hourlyRateCents : null,
          };
        });
        setExtras(xs);
      } catch (err) {
        console.warn("[staff-detail] extras fetch failed:", err);
        setExtras([]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Square unreachable.";
      console.error("[staff-detail] fetch failed:", err);
      setFetchError(msg);
      setShifts([]);
      setTeamMembers({});
    } finally {
      setBusy(false);
      setLoading(false);
    }
  }, [startISO, endISO]);

  useEffect(() => {
    if (authLoading || !allowed) return;
    void load();
  }, [authLoading, allowed, load]);

  const withEdit = useCallback((s: ShiftFromApi): ShiftFromApi => {
    const e = edits[s.id];
    if (!e) return s;
    let hours = s.hours;
    if (e.startAt && e.endAt) {
      hours = Math.round(((new Date(e.endAt).getTime() - new Date(e.startAt).getTime()) / 3_600_000) * 100) / 100;
      if (hours < 0) hours = 0;
    }
    return { ...s, startAt: e.startAt, endAt: e.endAt, hours };
  }, [edits]);

  const memberShifts = useMemo(() => {
    const merged = [...shifts, ...extras].filter((s) => s.teamMemberId === teamMemberId);
    return merged.map(withEdit).sort((a, b) => a.startAt.localeCompare(b.startAt));
  }, [shifts, extras, teamMemberId, withEdit]);

  const totalHours = useMemo(() => memberShifts.reduce((sum, s) => sum + s.hours, 0), [memberShifts]);
  const totalGross = useMemo(() => memberShifts.reduce((sum, s) => sum + (s.hours * ((s.hourlyRateCents ?? 0) / 100)), 0), [memberShifts]);

  // Other staff in the range for the quick-switch strip.
  const otherStaff = useMemo(() => {
    const agg: Record<string, { id: string; name: string; hours: number; shifts: number }> = {};
    for (const s of [...shifts, ...extras]) {
      if (s.teamMemberId === teamMemberId) continue;
      const row = (agg[s.teamMemberId] ??= {
        id: s.teamMemberId,
        name: nameOfMember(s.teamMemberId, teamMembers[s.teamMemberId]),
        hours: 0,
        shifts: 0,
      });
      row.hours += withEdit(s).hours;
      row.shifts += 1;
    }
    return Object.values(agg).sort((a, b) => b.hours - a.hours);
  }, [shifts, extras, teamMembers, teamMemberId, withEdit]);

  async function saveTimeEdit(shift: ShiftFromApi, field: "start" | "end", newHHMM: string) {
    if (!user) return;
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
        { ...patch, updatedAt: serverTimestamp(), updatedBy: user.uid },
        { merge: true },
      );
      setEdits((prev) => ({ ...prev, [shift.id]: patch }));
      setEditingField(null);
      // Flash a "Saved to Firebase" pill for 2 s so the owner can see
      // the write went through.
      setRecentlySaved((prev) => new Set(prev).add(shift.id));
      setTimeout(() => {
        setRecentlySaved((prev) => {
          const next = new Set(prev);
          next.delete(shift.id);
          return next;
        });
      }, 2000);
    } catch (err) {
      console.error("[timesheet_edits] save failed:", err);
      setEditError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSavingEditId(null);
    }
  }

  if (authLoading || loading) return <Splash />;
  if (!allowed) return <div className={styles.page}><p>Owner access only.</p></div>;

  const memberName = nameOfMember(teamMemberId, teamMembers[teamMemberId]);
  const memberColor = colorForId(teamMemberId);

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
        <p className={styles.eyebrow}>LABOUR</p>
        <h1 className={styles.title}>Timesheets</h1>
        <p className={styles.subtitle}>
          {startISO && endISO ? fmtRangeSubtitle(startISO, endISO) : ""}
        </p>
      </header>

      {/* Staff summary card */}
      <section className={styles.summaryCard}>
        <div className={styles.summaryHead}>
          <span className={styles.avatar} style={{ background: memberColor }} aria-hidden="true">
            {initialsOf(memberName)}
          </span>
          <div>
            <p className={styles.summaryName}>{memberName}</p>
            <p className={styles.summarySub}>{memberShifts.length} shifts · {fmtHours(totalHours)}</p>
          </div>
        </div>
        <div className={styles.summaryGrid}>
          <div>
            <p className={styles.summaryLabel}>TOTAL HOURS</p>
            <p className={styles.summaryValueOrange}>{fmtHours(totalHours)}</p>
          </div>
          <div>
            <p className={styles.summaryLabel}>EST. GROSS PAY</p>
            <p className={styles.summaryValueOrange}>{fmtMoney(totalGross)}</p>
          </div>
        </div>
      </section>

      {fetchError && <p className={styles.errorBanner}>Square Labor: {fetchError}</p>}
      {editError && <p className={styles.errorBanner}>{editError}</p>}
      {busy && !fetchError && <p className={styles.busyBanner}>Refreshing…</p>}

      {/* Shifts */}
      <p className={styles.shiftsHeading}>Shifts ({memberShifts.length})</p>
      <ul className={styles.shiftList}>
        {memberShifts.length === 0 && !busy && (
          <li className={styles.empty}>No shifts recorded in this range.</li>
        )}
        {memberShifts.map((s) => {
          const original = shifts.find((v) => v.id === s.id);
          const isEdited = !!edits[s.id];
          const isSaving = savingEditId === s.id;
          const editingStart = editingField?.shiftId === s.id && editingField.field === "start";
          const editingEnd = editingField?.shiftId === s.id && editingField.field === "end";
          const start = fmtClock(s.startAt);
          const end = fmtClock(s.endAt);
          const origStart = original ? fmtClock(edits[s.id]?.originalStartAt ?? original.startAt) : null;
          const origEnd = original ? fmtClock(edits[s.id]?.originalEndAt ?? original.endAt) : null;
          return (
            <li key={s.id} className={styles.shiftCard}>
              <p className={styles.shiftDate}>{fmtDay(s.dateISO)}</p>
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
                  >
                    <span className={styles.timeMain}>{end.hhmm}</span>
                    <span className={styles.timeAmpm}>{end.ampm}</span>
                  </button>
                )}
              </div>
              {isEdited && origStart && origEnd ? (
                <p className={styles.editedNote}>
                  <span className={styles.editedBadge}>EDITED</span>
                  <span className={styles.editedWas}>
                    {" "}· was {origStart.hhmm} {origStart.ampm} – {origEnd.hhmm} {origEnd.ampm}
                  </span>
                </p>
              ) : (
                <p className={styles.noEditsNote}>Store time (Australia/Sydney) · 5-minute steps</p>
              )}
              <div className={styles.shiftFooter}>
                <span className={styles.hoursText}>{fmtHours(s.hours)}</span>
                {isSaving && <span className={styles.savingHint}>Saving…</span>}
                {!isSaving && recentlySaved.has(s.id) && (
                  <span className={styles.savedPill}>Saved to Firebase ✓</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/* Other staff quick-switch */}
      {otherStaff.length > 0 && (
        <>
          <p className={styles.otherHeading}>Other staff</p>
          <ul className={styles.otherList}>
            {otherStaff.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/payroll/timesheets/staff/${encodeURIComponent(s.id)}?start=${startISO}&end=${endISO}`}
                  className={styles.otherRow}
                >
                  <span className={styles.otherAvatar} style={{ background: colorForId(s.id) }} aria-hidden="true">
                    {initialsOf(s.name)}
                  </span>
                  <div className={styles.otherBody}>
                    <p className={styles.otherName}>{s.name}</p>
                    <p className={styles.otherMeta}>{s.shifts} shifts</p>
                  </div>
                  <span className={styles.otherHours}>{fmtHours(s.hours)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className={styles.footNote}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        Edits stay in-app only. Square Labor is never modified.
      </div>
    </div>
  );
}
