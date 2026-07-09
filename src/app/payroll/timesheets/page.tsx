"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { isOwner } from "@/lib/permissions";
import {
  buildPayrollAttentionItems,
  fmtTrainingEndLabel,
  shouldActivatePayrollReminder,
  type PayrollAttentionItem,
  type PayrollStaffRecord,
} from "@/lib/payroll-attention";
import Splash from "@/components/Splash";
import CalendarPicker from "@/components/CalendarPicker";
import styles from "./page.module.css";

/*
 * Timesheets — pulls live Square Labor shifts (real clock-in / clock-out
 * records with break subtraction) from /api/square/timesheets. Aggregates
 * per calendar day and per team member; owner can also open individual
 * days/staff to see raw shift times.
 *
 * Legacy path: an earlier version read rosters_published and estimated
 * lunch=4h/dinner=5h. The Square feed replaces that estimate with the
 * actual paid hours the location recorded.
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

type DayAgg = {
  dateISO: string;
  staff: number;
  shifts: number;
  hours: number;
  gross: number;
  entries: ShiftFromApi[];
};

type StaffAgg = {
  teamMemberId: string;
  name: string;
  shifts: number;
  hours: number;
  gross: number;
  entries: ShiftFromApi[];
};

/* ── date helpers ────────────────────────────────────────────────── */

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

function isoSundayOfWeek(mondayISO: string): string {
  return addDaysISO(mondayISO, 6);
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

function fmtDayChip(iso: string): { dow: string; day: string } {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return {
    dow: dt.toLocaleDateString("en-AU", { weekday: "short", timeZone: "UTC" }).toUpperCase(),
    day: String(d),
  };
}

function fmtDayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function fmtRangeSubtitle(startISO: string, endISO: string): string {
  const [sy, sm, sd] = startISO.split("-").map(Number);
  const [ey, em, ed] = endISO.split("-").map(Number);
  const start = new Date(Date.UTC(sy, sm - 1, sd, 12));
  const end = new Date(Date.UTC(ey, em - 1, ed, 12));
  return `${start.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })} – ${end.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`;
}

function fmtHours(h: number): string {
  return `${h.toFixed(2)}h`;
}

function fmtMoney(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Format the clock-in / clock-out portion of a Square-returned ISO like
 * "2026-06-22T09:30:00+10:00" as a compact 12h string ("9:30 AM").
 * Falls back gracefully if the string is missing.
 */
function fmtClockTime(iso: string | null): string {
  if (!iso) return "…";
  const t = iso.slice(11, 16); // "HH:MM"
  const [hStr, mStr] = t.split(":");
  let h = parseInt(hStr, 10);
  if (Number.isNaN(h)) return t;
  const period = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${mStr} ${period}`;
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

function fmtRateHr(n: number): string {
  return `$${n.toFixed(2)}/hr`;
}

function staffStartISO(v: unknown): string {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (typeof v === "object" && v !== null && "toDate" in v) {
    try {
      return (v as { toDate: () => Date }).toDate().toISOString().slice(0, 10);
    } catch {
      return "";
    }
  }
  return "";
}

function staffNameOf(raw: Record<string, unknown>): string {
  if (typeof raw.fullName === "string" && raw.fullName.trim()) return raw.fullName.trim();
  const first = String(raw.firstName ?? "").trim();
  const last = String(raw.lastName ?? "").trim();
  return `${first}${last ? ` ${last}` : ""}`.trim() || "Unknown";
}

// Stable colour per team member id — matches the palette used on the
// roster page + day-details Staff view, so the same person always shows
// up in the same tint across the app.
const STAFF_COLORS = [
  "#e91e63", "#9c27b0", "#ff7043", "#26a69a", "#42a5f5",
  "#ffb300", "#ec407a", "#26c6da", "#7e57c2", "#66bb6a",
];
function colorForMemberId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return STAFF_COLORS[h % STAFF_COLORS.length];
}

/* ── page ────────────────────────────────────────────────────────── */

type ViewMode = "day" | "staff";

export default function TimesheetsPage() {
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwner(user);

  const [startISO, setStartISO] = useState<string>("");
  const [endISO, setEndISO] = useState<string>("");
  const [view, setView] = useState<ViewMode>("day");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState<null | "start" | "end">(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<{
    teamMemberId: string;
    dateISO: string;
    startHHMM: string;
    endHHMM: string;
  }>({ teamMemberId: "", dateISO: "", startHHMM: "10:00", endHHMM: "14:30" });
  const [savingAdd, setSavingAdd] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [shifts, setShifts] = useState<ShiftFromApi[]>([]);
  const [teamMembers, setTeamMembers] = useState<Record<string, TeamMemberFromApi>>({});
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const [payrollStaff, setPayrollStaff] = useState<PayrollStaffRecord[]>([]);
  const [attentionBusy, setAttentionBusy] = useState<string | null>(null);

  useEffect(() => {
    const today = sydneyTodayISO();
    const mon = isoMondayOf(today);
    setStartISO(mon);
    setEndISO(isoSundayOfWeek(mon));
  }, []);

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
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Square unreachable.";
      console.error("[timesheets] fetch failed:", err);
      setFetchError(msg);
      setShifts([]);
      setTeamMembers({});
    } finally {
      setBusy(false);
      setLoading(false);
    }
  }, [startISO, endISO]);

  const loadStaff = useCallback(async () => {
    try {
      const snap = await getDocs(collection(getDb(), "staff_onboarding"));
      const rows: PayrollStaffRecord[] = snap.docs.map((d) => {
        const raw = d.data() as Record<string, unknown>;
        return {
          uid: d.id,
          name: staffNameOf(raw),
          position: typeof raw.position === "string" ? raw.position : "Staff",
          startDate: staffStartISO(raw.startDate),
          trainingPeriod:
            typeof raw.trainingPeriod === "string" ? raw.trainingPeriod : "First 2 Weeks",
          trainingRate: typeof raw.trainingRate === "number" ? raw.trainingRate : null,
          afterTrainingRate:
            typeof raw.afterTrainingRate === "number" ? raw.afterTrainingRate : null,
          payrollRateNotedFor:
            typeof raw.payrollRateNotedFor === "string" ? raw.payrollRateNotedFor : "",
          payrollRateReminderActive: raw.payrollRateReminderActive !== false,
          accountCreated: !!raw.accountCreated,
          status: typeof raw.status === "string" ? raw.status : "",
        };
      });
      setPayrollStaff(rows);
    } catch (err) {
      console.error("[timesheets] staff_onboarding load failed:", err);
      setPayrollStaff([]);
    }
  }, []);

  useEffect(() => {
    if (authLoading || !allowed) return;
    void load();
    void loadStaff();
  }, [authLoading, allowed, load, loadStaff]);

  /* Filter shifts down to the requested range (the API pads by a day on
     each side to catch overnight shifts) and fold into per-day + per-
     staff aggregates. */
  const { days, byStaff, totalHours, totalShifts, totalStaff } = useMemo(() => {
    const days: DayAgg[] = [];
    const staffAgg: Record<string, StaffAgg> = {};
    let totalHours = 0;
    let totalShifts = 0;
    const allTMs = new Set<string>();

    if (!startISO || !endISO) {
      return { days, byStaff: [] as StaffAgg[], totalHours, totalShifts, totalStaff: 0 };
    }

    const byDate: Record<string, DayAgg> = {};
    for (const iso of eachDayISO(startISO, endISO)) {
      byDate[iso] = { dateISO: iso, staff: 0, shifts: 0, hours: 0, gross: 0, entries: [] };
    }

    for (const s of shifts) {
      if (!byDate[s.dateISO]) continue; // outside the requested range
      const rate = typeof s.hourlyRateCents === "number" ? s.hourlyRateCents / 100 : 0;
      const gross = s.hours * rate;

      const day = byDate[s.dateISO];
      day.entries.push(s);
      day.shifts += 1;
      day.hours += s.hours;
      day.gross += gross;

      const st = (staffAgg[s.teamMemberId] ??= {
        teamMemberId: s.teamMemberId,
        name: nameOfTeamMember(s.teamMemberId, teamMembers[s.teamMemberId]),
        shifts: 0,
        hours: 0,
        gross: 0,
        entries: [],
      });
      st.entries.push(s);
      st.shifts += 1;
      st.hours += s.hours;
      st.gross += gross;

      totalShifts += 1;
      totalHours += s.hours;
      allTMs.add(s.teamMemberId);
    }

    // Post-process staff count per day.
    for (const iso of Object.keys(byDate)) {
      const set = new Set(byDate[iso].entries.map((e) => e.teamMemberId));
      byDate[iso].staff = set.size;
      byDate[iso].entries.sort((a, b) => a.startAt.localeCompare(b.startAt));
      days.push(byDate[iso]);
    }
    for (const uid of Object.keys(staffAgg)) {
      staffAgg[uid].entries.sort((a, b) => a.startAt.localeCompare(b.startAt));
    }

    return {
      days,
      byStaff: Object.values(staffAgg).sort((a, b) => b.hours - a.hours),
      totalHours,
      totalShifts,
      totalStaff: allTMs.size,
    };
  }, [shifts, teamMembers, startISO, endISO]);

  const attentionItems = useMemo(() => {
    if (!startISO || !endISO) return [] as PayrollAttentionItem[];
    return buildPayrollAttentionItems(payrollStaff, startISO, endISO);
  }, [payrollStaff, startISO, endISO]);

  async function stopReminder(item: PayrollAttentionItem) {
    setAttentionBusy(item.staffUid);
    try {
      await updateDoc(doc(getDb(), "staff_onboarding", item.staffUid), {
        payrollRateNotedFor: item.trainingEndISO,
        payrollRateReminderActive: false,
      });
      setPayrollStaff((prev) =>
        prev.map((r) =>
          r.uid === item.staffUid
            ? {
                ...r,
                payrollRateNotedFor: item.trainingEndISO,
                payrollRateReminderActive: false,
              }
            : r,
        ),
      );
    } catch (err) {
      console.error("[timesheets] stop reminder failed:", err);
    } finally {
      setAttentionBusy(null);
    }
  }

  if (authLoading || loading) return <Splash />;
  if (!allowed) return <div className={styles.page}><p>Owner access only.</p></div>;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>LABOUR</p>
        <h1 className={styles.title}>Timesheets</h1>
        <p className={styles.subtitle}>
          <CalIcon /> {startISO && endISO ? fmtRangeSubtitle(startISO, endISO) : ""}
          {totalStaff > 0 && ` · ${totalStaff} staff`}
        </p>
      </header>

      <section className={styles.summaryRow}>
        <div className={styles.summaryCard}>
          <span className={styles.summaryIcon}><ClockIcon /></span>
          <div>
            <p className={styles.summaryLabel}>TOTAL PAID HOURS</p>
            <p className={styles.summaryValue}>
              {totalHours.toFixed(2)} <span className={styles.summaryUnit}>h</span>
            </p>
            <p className={styles.summarySub}>{totalStaff} staff · {totalShifts} shifts</p>
          </div>
        </div>
      </section>

      {attentionItems.length > 0 && (
        <section className={styles.attentionCard} aria-label="Payroll attention">
          <div className={styles.attentionHead}>
            <div className={styles.attentionHeadLeft}>
              <span className={styles.attentionIcon} aria-hidden="true">
                <WarnIcon />
              </span>
              <div>
                <p className={styles.attentionEyebrow}>PAYROLL ATTENTION</p>
                <p className={styles.attentionTitle}>
                  {attentionItems.length === 1
                    ? "1 employee may require wage increase"
                    : `${attentionItems.length} employees may require wage increase`}
                </p>
              </div>
            </div>
            <span className={styles.attentionChev} aria-hidden="true">›</span>
          </div>

          <ul className={styles.attentionList}>
            {attentionItems.map((item) => (
              <li key={item.staffUid} className={styles.attentionRow}>
                <Link
                  href={`/people/active/${item.staffUid}`}
                  className={styles.attentionMain}
                >
                  <span className={styles.attentionAvatar}>{initialsOf(item.name)}</span>
                  <div className={styles.attentionBody}>
                    <p className={styles.attentionName}>{item.name}</p>
                    <p className={styles.attentionMeta}>
                      Training period ended: {fmtTrainingEndLabel(item.trainingEndISO)}
                    </p>
                    <p className={styles.attentionRate}>
                      Current rate: {fmtRateHr(item.currentRate)} → New rate:{" "}
                      <strong className={styles.attentionRateNew}>
                        {fmtRateHr(item.newRate)}
                      </strong>
                    </p>
                  </div>
                </Link>
                <div className={styles.attentionActions}>
                  <button
                    type="button"
                    className={styles.attentionStopBtn}
                    disabled={attentionBusy === item.staffUid}
                    onClick={() => void stopReminder(item)}
                  >
                    {attentionBusy === item.staffUid
                      ? "…"
                      : "New rate applied. Stop the reminder."}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={styles.filterCard}>
        <div className={styles.rangeGrid}>
          <div className={styles.rangeField}>
            <span className={styles.rangeLabel}>Start</span>
            <button
              type="button"
              className={styles.rangeInput}
              onClick={() => setPickerOpen("start")}
              aria-label="Pick start date"
            >
              <CalIconSm />
              <span className={styles.rangeInputText}>
                {startISO ? `${fmtDayLabel(startISO)} ${startISO.slice(0, 4)}` : "—"}
              </span>
            </button>
          </div>
          <div className={styles.rangeField}>
            <span className={styles.rangeLabel}>End</span>
            <button
              type="button"
              className={styles.rangeInput}
              onClick={() => setPickerOpen("end")}
              aria-label="Pick end date"
            >
              <CalIconSm />
              <span className={styles.rangeInputText}>
                {endISO ? `${fmtDayLabel(endISO)} ${endISO.slice(0, 4)}` : "—"}
              </span>
            </button>
          </div>
          <button
            type="button"
            className={styles.applyBtn}
            onClick={() => void load()}
            disabled={busy || !startISO || !endISO || startISO > endISO}
          >
            {busy ? "…" : "Apply"}
          </button>
        </div>
      </section>

      {pickerOpen && (
        <CalendarPicker
          value={pickerOpen === "start" ? startISO : endISO}
          minDate={pickerOpen === "end" ? startISO : undefined}
          /* CalendarPicker requires a maxDate — when picking End we cap
             at one year past today so future scheduling is possible;
             when picking Start we cap at the current End so we can't
             pick a start after the end. */
          maxDate={
            pickerOpen === "start"
              ? (endISO || addDaysISO(sydneyTodayISO(), 365))
              : addDaysISO(sydneyTodayISO(), 365)
          }
          singleOnly
          onChange={(d) => {
            if (pickerOpen === "start") setStartISO(d);
            else setEndISO(d);
          }}
          onRangeChange={() => { /* range mode disabled via singleOnly */ }}
          onClose={() => setPickerOpen(null)}
        />
      )}

      {fetchError && (
        <p className={styles.errorBanner}>Square Labor: {fetchError}</p>
      )}

      <div className={styles.summaryHeader}>
        <p className={styles.sectionEyebrow}>BY {view === "day" ? "DAY" : "STAFF"} SUMMARY</p>
        <Link href="/scheduling/roster" className={styles.viewCalLink}>
          <CalIconSm /> View roster
        </Link>
      </div>

      <div className={styles.actionRow}>
        <div className={styles.viewToggle} role="tablist" aria-label="View mode">
          <button
            type="button"
            role="tab"
            aria-selected={view === "day"}
            className={`${styles.toggleBtn} ${view === "day" ? styles.toggleBtnActive : ""}`}
            onClick={() => { setView("day"); setExpandedRow(null); }}
          >
            Day
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "staff"}
            className={`${styles.toggleBtn} ${view === "staff" ? styles.toggleBtnActive : ""}`}
            onClick={() => { setView("staff"); setExpandedRow(null); }}
          >
            Staff
          </button>
        </div>
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
        <button
          type="button"
          className={styles.refreshBtn}
          onClick={() => void load()}
          disabled={busy}
        >
          <RefreshIcon /> Refresh
        </button>
      </div>

      {view === "day" ? (
        <ul className={styles.list}>
          {days.map((d) => {
            const chip = fmtDayChip(d.dateISO);
            return (
              <li key={d.dateISO} className={styles.rowBlock}>
                <Link
                  href={`/payroll/timesheets/${d.dateISO}`}
                  className={styles.row}
                >
                  <span className={styles.dayChip}>
                    <span className={styles.dayChipDow}>{chip.dow}</span>
                    <span className={styles.dayChipNum}>{chip.day}</span>
                  </span>
                  <div className={styles.rowBody}>
                    <p className={styles.rowTitle}>{fmtDayLabel(d.dateISO)}</p>
                    <p className={styles.rowMeta}>
                      {d.staff} staff · {d.shifts} shifts
                    </p>
                  </div>
                  <span className={styles.rowValue}>{fmtHours(d.hours)}</span>
                  <span className={styles.rowChev} aria-hidden="true">›</span>
                </Link>
              </li>
            );
          })}
          {days.length === 0 && <p className={styles.empty}>No shifts in this range.</p>}
        </ul>
      ) : (
        <>
          <div className={styles.staffColHeader}>
            <span>STAFF</span>
            <span>HOURS</span>
            <span>SHIFTS</span>
            <span />
          </div>
          <ul className={styles.list}>
            {byStaff.map((s) => {
              const firstStart = s.entries.reduce<string | null>(
                (a, b) => (a === null || b.startAt < a ? b.startAt : a),
                null,
              );
              const lastEnd = s.entries.reduce<string | null>(
                (a, b) => (b.endAt && (a === null || b.endAt > a) ? b.endAt : a),
                null,
              );
              return (
                <li key={s.teamMemberId} className={styles.rowBlock}>
                  <Link
                    href={`/payroll/timesheets/staff/${encodeURIComponent(s.teamMemberId)}?start=${startISO}&end=${endISO}`}
                    className={`${styles.row} ${styles.rowStaff}`}
                  >
                    <div className={styles.rowBody}>
                      <p className={styles.rowTitle}>{s.name}</p>
                      <p className={styles.rowMeta}>
                        {s.shifts} shifts · {fmtMoney(s.gross)}
                      </p>
                    </div>
                    <div className={styles.staffHoursCol}>
                      <p className={styles.staffHoursMain}>{fmtHours(s.hours)}</p>
                      {firstStart && (
                        <p className={styles.staffHoursSub}>
                          {fmtClockTime(firstStart)} – {fmtClockTime(lastEnd)}
                        </p>
                      )}
                    </div>
                    <span className={styles.staffShiftsCol}>{s.shifts}</span>
                    <span className={styles.rowChev} aria-hidden="true">›</span>
                  </Link>
                </li>
              );
            })}
            {byStaff.length === 0 && <p className={styles.empty}>No staff shifts in this range.</p>}
          </ul>
        </>
      )}

      {pushMessage && <p className={styles.pushBanner}>{pushMessage}</p>}

      <button
        type="button"
        className={styles.pushBtn}
        disabled={pushBusy || busy || !startISO || !endISO || totalShifts === 0}
        onClick={async () => {
          if (!user || !startISO || !endISO) return;
          setPushBusy(true);
          setPushMessage(null);
          try {
            const idToken = await user.getIdToken();
            const res = await fetch("/api/payroll/push", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${idToken}`,
              },
              body: JSON.stringify({ startDate: startISO, endDate: endISO }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error ?? `Push failed (${res.status})`);
            const unmatched =
              Array.isArray(data.unmatchedStaff) && data.unmatchedStaff.length > 0
                ? ` Unmatched: ${data.unmatchedStaff.join(", ")}.`
                : "";
            setPushMessage(
              `${data.title ?? "Pay History"} written to Google Sheets (${data.matchedStaff ?? 0} staff, ${data.shiftCount ?? 0} shifts).${unmatched}`,
            );
            if (typeof data.sheetUrl === "string" && data.sheetUrl.startsWith("https://")) {
              window.open(data.sheetUrl, "_blank", "noopener,noreferrer");
            }
          } catch (err) {
            setPushMessage(err instanceof Error ? err.message : "Push to Google failed.");
          } finally {
            setPushBusy(false);
          }
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14" />
          <polyline points="19 12 12 19 5 12" />
        </svg>
        {pushBusy ? "Pushing…" : "Push to Google"}
      </button>

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
              <button type="button" className={styles.modalClose} onClick={() => setAddOpen(false)} aria-label="Close">×</button>
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
              value={addForm.dateISO}
              onChange={(e) => setAddForm((p) => ({ ...p, dateISO: e.target.value }))}
              disabled={savingAdd}
              min={startISO || undefined}
              max={endISO || undefined}
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
                onClick={async () => {
                  if (!user) return;
                  if (!addForm.teamMemberId) { setAddError("Pick a staff member."); return; }
                  if (!addForm.dateISO) { setAddError("Pick a date."); return; }
                  if (!/^\d{2}:\d{2}$/.test(addForm.startHHMM) || !/^\d{2}:\d{2}$/.test(addForm.endHHMM)) {
                    setAddError("Enter times in HH:MM format.");
                    return;
                  }
                  // Use the location offset from an existing shift on that
                  // day if we have one, otherwise fall back to +10:00.
                  const dayShift = shifts.find((s) => s.dateISO === addForm.dateISO);
                  const offMatch = dayShift ? /([+-]\d{2}:\d{2})$/.exec(dayShift.startAt) : null;
                  const offset = offMatch ? offMatch[1] : "+10:00";
                  const startAt = `${addForm.dateISO}T${addForm.startHHMM}:00${offset}`;
                  const endAt = `${addForm.dateISO}T${addForm.endHHMM}:00${offset}`;
                  const hours = Math.round(
                    ((new Date(endAt).getTime() - new Date(startAt).getTime()) / 3_600_000) * 100,
                  ) / 100;
                  if (hours <= 0) { setAddError("End time must be after start time."); return; }
                  setSavingAdd(true);
                  setAddError(null);
                  try {
                    await addDoc(collection(getDb(), "timesheet_extra_shifts"), {
                      teamMemberId: addForm.teamMemberId,
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
                    setAddForm({ teamMemberId: "", dateISO: "", startHHMM: "10:00", endHHMM: "14:30" });
                    void load();
                  } catch (err) {
                    console.error("[timesheet_extra_shifts] add failed:", err);
                    setAddError(err instanceof Error ? err.message : "Save failed.");
                  } finally {
                    setSavingAdd(false);
                  }
                }}
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

/* ── icons ───────────────────────────────────────────────────────── */

function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </svg>
  );
}
function CalIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "inline-block", marginRight: 6, verticalAlign: "-2px" }}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}
function CalIconSm() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
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
function WarnIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
