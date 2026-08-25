"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  trainingEndStatusLabel,
  shouldActivatePayrollReminder,
  type PayrollAttentionItem,
  type PayrollStaffRecord,
} from "@/lib/payroll-attention";
import { readTimesheetsCache, writeTimesheetsCache } from "@/lib/timesheets-cache";
import { sortShiftsByServiceThenStart } from "@/lib/timesheet-sort";
import { ROUNDING_STEP_SECONDS } from "@/lib/timesheet-rounding";
import { DayExpandedPanel } from "./DayExpandedPanel";
import styles from "./page.module.css";

/*
 * Timesheets — Square Labor is read-only: we import clock-in/out and paid
 * hours from /api/square/timesheets (via the merged payroll feed below).
 * Owner edits and backfilled shifts are stored in Firestore only
 * (`timesheet_edits`, `timesheet_extra_shifts`) and never pushed to Square.
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
  /** What the employee's own clock recorded, before the quarter-hour snap and
   *  before any owner correction. Null for a shift that never went through the
   *  clock — an owner backfill. Carried through to the day panel, which shows
   *  it under the paid times. */
  clockedStartAt?: string | null;
  clockedEndAt?: string | null;
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

/** "10 – 16 Aug 2026", collapsing the month when both ends share one. */
function fmtPayPeriod(startISO: string, endISO: string): string {
  if (!startISO || !endISO) return "—";
  const [sy, sm, sd] = startISO.split("-").map(Number);
  const [ey, em, ed] = endISO.split("-").map(Number);
  const end = new Date(Date.UTC(ey, em - 1, ed, 12)).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const start =
    sy === ey && sm === em
      ? String(sd)
      : new Date(Date.UTC(sy, sm - 1, sd, 12)).toLocaleDateString("en-AU", {
          day: "numeric",
          month: "short",
          timeZone: "UTC",
        });
  return `${start} – ${end}`;
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

/** Reply from /api/payroll/payslips/publish, narrowed to what the card shows. */
type PublicationState = {
  published: boolean;
  publishedAt: string | null;
  /** Null when the sheet could not be read — not the same as nobody paid. */
  employeeCount: number | null;
};

function readPublication(data: unknown): PublicationState {
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    published: d.published === true,
    publishedAt: typeof d.publishedAt === "string" ? d.publishedAt : null,
    employeeCount: typeof d.employeeCount === "number" ? d.employeeCount : null,
  };
}

/* ── page ────────────────────────────────────────────────────────── */

type ViewMode = "day" | "staff";
type DatePreset = "today" | "yesterday" | "this-week" | "last-7" | "last-30" | "custom";

/** How many pay weeks the publish picker lists, newest first. 52 covers the
 *  same 12 months the staff payslip page is willing to show. */
const PAY_WEEK_CHOICES = 52;

function rangeForPreset(preset: DatePreset): { start: string; end: string } {
  const today = sydneyTodayISO();
  if (preset === "today") return { start: today, end: today };
  if (preset === "yesterday") {
    const y = addDaysISO(today, -1);
    return { start: y, end: y };
  }
  if (preset === "this-week") {
    const mon = isoMondayOf(today);
    return { start: mon, end: isoSundayOfWeek(mon) };
  }
  if (preset === "last-30") return { start: addDaysISO(today, -29), end: today };
  // last-7 (default)
  return { start: addDaysISO(today, -6), end: today };
}

export default function TimesheetsPage() {
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwner(user);

  const initialRange = useMemo(() => rangeForPreset("last-7"), []);
  const initialCache = useMemo(
    () => readTimesheetsCache(initialRange.start, initialRange.end),
    [initialRange.start, initialRange.end],
  );

  const [startISO, setStartISO] = useState(initialRange.start);
  const [endISO, setEndISO] = useState(initialRange.end);
  const [datePreset, setDatePreset] = useState<DatePreset>("last-7");
  const [view, setView] = useState<ViewMode>("day");
  const [loading, setLoading] = useState(() => !initialCache);
  const [busy, setBusy] = useState(false);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<{
    teamMemberId: string;
    dateISO: string;
    startHHMM: string;
    endHHMM: string;
  }>({ teamMemberId: "", dateISO: "", startHHMM: "10:00", endHHMM: "14:30" });
  const [savingAdd, setSavingAdd] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [shifts, setShifts] = useState<ShiftFromApi[]>(
    () => (initialCache?.shifts as ShiftFromApi[] | undefined) ?? [],
  );
  const [teamMembers, setTeamMembers] = useState<Record<string, TeamMemberFromApi>>(
    () => (initialCache?.teamMembers as Record<string, TeamMemberFromApi> | undefined) ?? {},
  );
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const [payrollStaff, setPayrollStaff] = useState<PayrollStaffRecord[]>([]);
  const [attentionBusy, setAttentionBusy] = useState<string | null>(null);

  /**
   * Payslip release switch.
   *
   * Pay weeks run Monday–Sunday, but this page's date range is free-form —
   * the default is the last 7 days, which starts mid-week. The card therefore
   * picks its own week rather than inheriting the range verbatim, seeded from
   * the Monday the range starts in so the common case needs no interaction,
   * and re-seeded whenever the range moves. The owner can override it from the
   * card's own picker: publishing a week you are not currently looking at (a
   * late correction to a fortnight-old week, say) shouldn't mean rewriting the
   * date range and losing your place in the shift list.
   */
  const rangePayWeekISO = useMemo(() => (startISO ? isoMondayOf(startISO) : ""), [startISO]);
  const [payWeekStartISO, setPayWeekStartISO] = useState(rangePayWeekISO);
  useEffect(() => {
    setPayWeekStartISO(rangePayWeekISO);
  }, [rangePayWeekISO]);
  const payWeekEndISO = useMemo(
    () => (payWeekStartISO ? isoSundayOfWeek(payWeekStartISO) : ""),
    [payWeekStartISO],
  );
  /** Weeks offered in the picker. Matched to the 12 months the staff payslip
   *  page offers — there is no point releasing a week nobody can open. */
  const payWeekChoices = useMemo(() => {
    const weeks = new Set<string>();
    let cur = isoMondayOf(sydneyTodayISO());
    for (let i = 0; i < PAY_WEEK_CHOICES; i++) {
      weeks.add(cur);
      cur = addDaysISO(cur, -7);
    }
    // A range dragged back past the window would otherwise leave the select
    // with no matching option, which renders as a blank control.
    if (payWeekStartISO) weeks.add(payWeekStartISO);
    return [...weeks].sort().reverse();
  }, [payWeekStartISO]);
  const [publication, setPublication] = useState<PublicationState | null>(null);
  const [publishLoading, setPublishLoading] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  useEffect(() => {
    if (!allowed || !user || !payWeekStartISO) return;
    let cancelled = false;
    setPublishLoading(true);
    // Drop the previous week's answer immediately — showing "Published"
    // against a week we haven't checked yet would be a lie in the one
    // place the owner is trusting the screen.
    setPublication(null);
    setPublishError(null);
    (async () => {
      try {
        const idToken = await user.getIdToken();
        const res = await fetch(
          `/api/payroll/payslips/publish?week=${encodeURIComponent(payWeekStartISO)}`,
          { headers: { Authorization: `Bearer ${idToken}` }, cache: "no-store" },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status})`);
        if (!cancelled) setPublication(readPublication(data));
      } catch (err) {
        if (!cancelled) setPublishError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setPublishLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allowed, user, payWeekStartISO]);

  const togglePublish = useCallback(async () => {
    if (!user || !payWeekStartISO) return;
    const next = !(publication?.published ?? false);
    setPublishBusy(true);
    setPublishError(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/payroll/payslips/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ weekStartISO: payWeekStartISO, published: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status})`);
      setPublication(readPublication(data));
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : String(err));
    } finally {
      setPublishBusy(false);
    }
  }, [user, payWeekStartISO, publication]);

  /**
   * `fresh` skips the server's short Square cache — used after a write, so the
   * reconciling fetch can't hand back the numbers from before it.
   *
   * Corrections come in bursts, and each one starts its own reload. Only the
   * newest is allowed to land: an earlier reply arriving late carries a
   * timesheet that predates the last edit, and applying it would roll the
   * owner's own correction back on screen.
   */
  const loadSeq = useRef(0);
  const load = useCallback(async (opts?: { fresh?: boolean }) => {
    if (!startISO || !endISO) return;
    const seq = (loadSeq.current += 1);
    const superseded = () => seq !== loadSeq.current;
    setBusy(true);
    setFetchError(null);
    try {
      const res = await fetch(
        `/api/payroll/timesheets?startDate=${encodeURIComponent(startISO)}&endDate=${encodeURIComponent(endISO)}${opts?.fresh ? "&fresh=1" : ""}`,
      );
      const data = await res.json().catch(() => ({}));
      if (superseded()) return;
      if (!res.ok) throw new Error(data?.error ?? `Fetch failed (${res.status})`);
      const nextShifts = Array.isArray(data.shifts) ? (data.shifts as ShiftFromApi[]) : [];
      const nextMembers =
        data.teamMembers && typeof data.teamMembers === "object"
          ? (data.teamMembers as Record<string, TeamMemberFromApi>)
          : {};
      setShifts(nextShifts);
      setTeamMembers(nextMembers);
      writeTimesheetsCache(startISO, endISO, nextShifts, nextMembers);
    } catch (err) {
      if (superseded()) return;
      const msg = err instanceof Error ? err.message : "Timesheet fetch failed.";
      console.error("[timesheets] fetch failed:", err);
      setFetchError(msg);
      setShifts((prev) => {
        if (prev.length === 0) setTeamMembers({});
        return prev.length === 0 ? [] : prev;
      });
    } finally {
      if (!superseded()) {
        setBusy(false);
        setLoading(false);
      }
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
    void loadStaff();
  }, [authLoading, allowed, loadStaff]);

  useEffect(() => {
    if (authLoading || !allowed || !startISO || !endISO) return;
    const cached = readTimesheetsCache(startISO, endISO);
    if (cached) {
      setShifts(cached.shifts as ShiftFromApi[]);
      setTeamMembers(cached.teamMembers as Record<string, TeamMemberFromApi>);
      setLoading(false);
    } else {
      setLoading(true);
    }
    void load();
  }, [authLoading, allowed, startISO, endISO, load]);

  /* Re-fetch staff when returning from onboarding approval so the alert
     appears without a manual refresh. */
  useEffect(() => {
    if (authLoading || !allowed) return;
    const onFocus = () => void loadStaff();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void loadStaff();
    });
    return () => window.removeEventListener("focus", onFocus);
  }, [authLoading, allowed, loadStaff]);

  /**
   * Fold the loaded shifts into the totals the page shows. Everything on
   * screen — the two tiles, each day's pill, each staff card — is derived
   * here, so a shift patched in after an edit moves all of them at once.
   *
   * A shift whose employee has no rate on their profile is counted in the
   * hours but priced at nothing. That is reported rather than absorbed:
   * an "Est. gross pay" quietly missing someone's shift is worse than one
   * that admits the gap.
   */
  const {
    days,
    byStaff,
    totalHours,
    totalShifts,
    totalStaff,
    totalGross,
    unratedNames,
    unratedHours,
  } = useMemo(() => {
    const days: DayAgg[] = [];
    const staffAgg: Record<string, StaffAgg> = {};
    let totalHours = 0;
    let totalShifts = 0;
    let totalGross = 0;
    let unratedHours = 0;
    const allTMs = new Set<string>();
    const unratedTMs = new Set<string>();

    if (!startISO || !endISO) {
      return {
        days,
        byStaff: [] as StaffAgg[],
        totalHours,
        totalShifts,
        totalStaff: 0,
        totalGross,
        unratedNames: [] as string[],
        unratedHours,
      };
    }

    const byDate: Record<string, DayAgg> = {};
    for (const iso of eachDayISO(startISO, endISO)) {
      byDate[iso] = { dateISO: iso, staff: 0, shifts: 0, hours: 0, gross: 0, entries: [] };
    }

    for (const s of shifts) {
      if (!byDate[s.dateISO]) continue; // outside the requested range
      const hasRate = typeof s.hourlyRateCents === "number";
      const rate = hasRate ? (s.hourlyRateCents as number) / 100 : 0;
      const gross = s.hours * rate;
      if (!hasRate) {
        unratedHours += s.hours;
        unratedTMs.add(s.teamMemberId);
      }

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
      totalGross += gross;
      allTMs.add(s.teamMemberId);
    }

    // Post-process staff count per day.
    for (const iso of Object.keys(byDate)) {
      const set = new Set(byDate[iso].entries.map((e) => e.teamMemberId));
      byDate[iso].staff = set.size;
      byDate[iso].entries = sortShiftsByServiceThenStart(byDate[iso].entries, teamMembers);
      days.push(byDate[iso]);
    }
    for (const uid of Object.keys(staffAgg)) {
      staffAgg[uid].entries.sort((a, b) => a.startAt.localeCompare(b.startAt));
    }

    return {
      days,
      byStaff: Object.values(staffAgg).sort((a, b) => a.name.localeCompare(b.name, "en-AU")),
      totalHours,
      totalShifts,
      totalStaff: allTMs.size,
      totalGross,
      unratedNames: [...unratedTMs]
        .map((id) => nameOfTeamMember(id, teamMembers[id]))
        .sort((a, b) => a.localeCompare(b, "en-AU")),
      unratedHours,
    };
  }, [shifts, teamMembers, startISO, endISO]);

  /**
   * Fold a just-saved change straight into the loaded shifts, then reconcile
   * with the server. The write itself is already committed; waiting on a
   * Square round-trip before the totals move makes a saved edit look lost.
   */
  const applyLocalChange = useCallback(
    (mutate: (prev: ShiftFromApi[]) => ShiftFromApi[]) => {
      const next = mutate(shifts);
      setShifts(next);
      writeTimesheetsCache(startISO, endISO, next, teamMembers);
      void load({ fresh: true });
    },
    [shifts, startISO, endISO, teamMembers, load],
  );

  const handleShiftEdited = useCallback(
    (shiftId: string, patch: { startAt: string; endAt: string | null; hours: number }) => {
      applyLocalChange((prev) =>
        prev.map((s) => (s.id === shiftId ? { ...s, ...patch } : s)),
      );
    },
    [applyLocalChange],
  );

  const handleShiftRemoved = useCallback(
    (shiftId: string) => {
      applyLocalChange((prev) => prev.filter((s) => s.id !== shiftId));
    },
    [applyLocalChange],
  );

  const attentionItems = useMemo(() => buildPayrollAttentionItems(payrollStaff), [payrollStaff]);
  const todayISO = useMemo(() => sydneyTodayISO(), []);

  async function stopReminder(item: PayrollAttentionItem) {
    setAttentionBusy(item.staffUid);
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
    try {
      await updateDoc(doc(getDb(), "staff_onboarding", item.staffUid), {
        payrollRateNotedFor: item.trainingEndISO,
        payrollRateReminderActive: false,
      });
    } catch (err) {
      console.error("[timesheets] stop reminder failed:", err);
      void loadStaff();
    } finally {
      setAttentionBusy(null);
    }
  }

  if (authLoading) {
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <h1 className={styles.title}>Timesheets</h1>
        </header>
        <section className={styles.summaryRow} aria-busy="true">
          <div className={`${styles.summaryCard} ${styles.summaryCardBlue} ${styles.summarySkeleton}`} />
          <div className={`${styles.summaryCard} ${styles.summaryCardGreen} ${styles.summarySkeleton}`} />
        </section>
      </div>
    );
  }
  if (!allowed) return <div className={styles.page}><p>Owner access only.</p></div>;

  const showShiftSkeleton = loading && shifts.length === 0;

  // Name the people the estimate is missing — the owner can only close the
  // gap if they know whose profile to open.
  const grossSub =
    !showShiftSkeleton && unratedNames.length > 0
      ? `No rate: ${
          unratedNames.length <= 2
            ? unratedNames.join(", ")
            : `${unratedNames.slice(0, 2).join(", ")} +${unratedNames.length - 2}`
        } · ${unratedHours.toFixed(2)} h unpriced`
      : "Shift date rate × paid hours";

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Timesheets</h1>
        <p className={styles.subtitle}>
          {startISO && endISO ? fmtRangeSubtitle(startISO, endISO) : ""}
          {totalStaff > 0 && ` · ${totalStaff} staff`}
        </p>
      </header>

      <section className={styles.summaryRow}>
        <div className={`${styles.summaryCard} ${styles.summaryCardBlue} ${showShiftSkeleton ? styles.summarySkeleton : ""}`}>
          <p className={styles.summaryLabel}>Total paid hours</p>
          <p className={styles.summaryValue}>{showShiftSkeleton ? "—" : `${totalHours.toFixed(2)} h`}</p>
          <p className={styles.summarySub}>
            {showShiftSkeleton ? "Loading…" : `${totalStaff} staff · ${totalShifts} shifts`}
          </p>
        </div>
        <div className={`${styles.summaryCard} ${styles.summaryCardGreen} ${showShiftSkeleton ? styles.summarySkeleton : ""}`}>
          <p className={styles.summaryLabel}>Est. gross pay</p>
          <p className={styles.summaryValue}>{showShiftSkeleton ? "—" : fmtMoney(totalGross)}</p>
          <p
            className={`${styles.summarySub} ${unratedNames.length > 0 && !showShiftSkeleton ? styles.summarySubWarn : ""}`}
          >
            {grossSub}
          </p>
        </div>
      </section>

      {/* Payslip release. Sits directly under the totals because it is the
          decision made after reading them — the week's hours look right, so
          staff may now see what they were paid. Until this is on, the staff
          payslip feed returns nothing for the week, so an unchecked week
          can't be reached by guessing a URL either. */}
      <section className={styles.publishCard} aria-label="Payslip publishing">
        <div className={styles.publishHead}>
          <span className={styles.publishIcon} aria-hidden="true">
            <PayslipIcon />
          </span>
          <p className={styles.publishTitle}>Payslips</p>
          <span
            className={`${styles.publishStatus} ${
              publication?.published ? styles.publishStatusOn : ""
            }`}
          >
            <span className={styles.publishDot} aria-hidden="true" />
            {publishLoading && !publication
              ? "Checking…"
              : publication?.published
                ? "Published"
                : "Not Published"}
          </span>
        </div>

        <p className={styles.publishMeta}>
          <span className={styles.publishMetaIcon} aria-hidden="true">
            <PeopleIcon />
          </span>
          {publication?.employeeCount == null
            ? "Employee count unavailable"
            : `${publication.employeeCount} ${
                publication.employeeCount === 1 ? "employee" : "employees"
              }`}
        </p>
        <label className={styles.publishWeek}>
          <span className={styles.publishMetaIcon} aria-hidden="true">
            <CalIconSm />
          </span>
          <span className={styles.publishWeekLabel}>For pay period</span>
          <select
            className={styles.publishWeekSelect}
            value={payWeekStartISO}
            // Saving writes the week captured at click time, so let the
            // picker settle before it can be moved again.
            disabled={publishBusy}
            onChange={(e) => setPayWeekStartISO(e.target.value)}
          >
            {payWeekChoices.map((weekISO) => (
              <option key={weekISO} value={weekISO}>
                {fmtPayPeriod(weekISO, isoSundayOfWeek(weekISO))}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className={`${styles.publishBtn} ${
            publication?.published ? styles.publishBtnOn : ""
          }`}
          disabled={publishBusy || publishLoading || !payWeekStartISO}
          onClick={togglePublish}
        >
          {publishBusy
            ? "Saving…"
            : publication?.published
              ? "Unpublish Payslips"
              : "Publish Payslips"}
        </button>

        <p className={styles.publishCaption}>
          {publication?.published
            ? "Employees can see their payslips for this pay period."
            : "Employees will be able to view their payslips after publishing."}
        </p>

        {publishError && <p className={styles.publishError}>{publishError}</p>}
      </section>

      {attentionItems.length > 0 && (
        <section className={styles.attentionCard} aria-label="Payroll attention">
          <div className={styles.attentionHead}>
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

          <ul className={styles.attentionList}>
            {attentionItems.map((item) => (
              <li key={item.staffUid} className={styles.attentionRow}>
                <Link
                  href={`/people/active/${item.staffUid}`}
                  className={styles.attentionNameLink}
                >
                  {item.name}
                </Link>
                <div className={styles.attentionDetailRow}>
                  <div className={styles.attentionDetailText}>
                    <p className={styles.attentionMeta}>
                      {trainingEndStatusLabel(item.trainingEndISO, todayISO)}
                    </p>
                    <p className={styles.attentionRateLine}>
                      Current rate: {fmtRateHr(item.currentRate)} → New rate:{" "}
                      <strong className={styles.attentionRateNew}>
                        {fmtRateHr(item.newRate)}
                      </strong>
                    </p>
                  </div>
                  <button
                    type="button"
                    className={styles.attentionStopBtn}
                    disabled={attentionBusy === item.staffUid}
                    aria-label={`Stop payroll reminder for ${item.name}`}
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

      <p className={styles.sectionLabel}>DATE RANGE</p>
      <section className={styles.filterCard}>
        <div className={styles.chipsRow}>
          {(
            [
              ["today", "Today"],
              ["yesterday", "Yesterday"],
              ["this-week", "This week"],
              ["last-7", "Last 7 days"],
              ["last-30", "Last 30 days"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`${styles.chip} ${datePreset === key ? styles.chipActive : ""}`}
              onClick={() => {
                const { start, end } = rangeForPreset(key);
                setDatePreset(key);
                setStartISO(start);
                setEndISO(end);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className={styles.rangeGrid}>
          <div className={styles.rangeField}>
            <span className={styles.rangeLabel}>Start</span>
            <input
              type="date"
              className={styles.dateInput}
              value={startISO}
              onChange={(e) => {
                setStartISO(e.target.value);
                setDatePreset("custom");
              }}
            />
          </div>
          <div className={styles.rangeField}>
            <span className={styles.rangeLabel}>End</span>
            <input
              type="date"
              className={styles.dateInput}
              value={endISO}
              min={startISO || undefined}
              onChange={(e) => {
                setEndISO(e.target.value);
                setDatePreset("custom");
              }}
            />
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

      {fetchError && (
        <p className={styles.errorBanner}>Timesheets: {fetchError}</p>
      )}

      <div className={styles.listSectionHead}>
        <div>
          <p className={styles.sectionLabel}>BY {view === "day" ? "DAY" : "STAFF"}</p>
          <p className={styles.listSectionMeta}>
            {startISO} ~ {endISO}
            {view === "day" ? ` · ${days.length} days` : ` · ${byStaff.length}`}
          </p>
        </div>
        <div className={styles.actionRow}>
          <div className={styles.viewToggle} role="tablist" aria-label="View mode">
            <button
              type="button"
              role="tab"
              aria-selected={view === "day"}
              className={`${styles.toggleBtn} ${view === "day" ? styles.toggleBtnActive : ""}`}
              onClick={() => { setView("day"); setExpandedDay(null); }}
            >
              Day
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "staff"}
              className={`${styles.toggleBtn} ${view === "staff" ? styles.toggleBtnActive : ""}`}
              onClick={() => { setView("staff"); setExpandedDay(null); }}
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
            onClick={() => void load({ fresh: true })}
            disabled={busy}
          >
            <RefreshIcon /> Refresh
          </button>
        </div>
      </div>

      {view === "day" ? (
        <ul className={styles.list}>
          {days.map((d) => {
            const chip = fmtDayChip(d.dateISO);
            const open = expandedDay === d.dateISO;
            return (
              <li key={d.dateISO} className={styles.rowBlock}>
                <button
                  type="button"
                  className={`${styles.dayHeaderBtn} ${open ? styles.dayHeaderBtnExpanded : ""}`}
                  aria-expanded={open}
                  onClick={() => setExpandedDay(open ? null : d.dateISO)}
                >
                  <span className={styles.dayChip}>
                    <span className={styles.dayChipDow}>{chip.dow}</span>
                  </span>
                  <div className={styles.rowBody}>
                    <div className={styles.rowTitleLine}>
                      <p className={styles.rowTitle}>{fmtDayLabel(d.dateISO)}</p>
                      <span className={styles.hoursPill}>{d.hours.toFixed(2)}h</span>
                    </div>
                    <p className={styles.rowMeta}>
                      {d.staff} staff · {d.shifts} shifts
                    </p>
                  </div>
                  <span className={`${styles.rowChev} ${open ? styles.rowChevOpen : ""}`} aria-hidden="true">
                    ›
                  </span>
                </button>
                {open && user && (
                  <DayExpandedPanel
                    dateISO={d.dateISO}
                    entries={d.entries}
                    teamMembers={teamMembers}
                    userId={user.uid}
                    onShiftEdited={handleShiftEdited}
                    onShiftRemoved={handleShiftRemoved}
                  />
                )}
              </li>
            );
          })}
          {days.length === 0 && <p className={styles.empty}>No shifts in this range.</p>}
        </ul>
      ) : (
        <ul className={styles.list}>
          {byStaff.map((s) => (
            <li key={s.teamMemberId} className={styles.rowBlock}>
              <Link
                href={`/payroll/timesheets/staff/${encodeURIComponent(s.teamMemberId)}?start=${startISO}&end=${endISO}`}
                className={styles.staffRowLink}
              >
                <div className={styles.rowBody}>
                  <div className={styles.rowTitleLine}>
                    <p className={styles.rowTitle}>{s.name}</p>
                    <span className={styles.hoursPill}>{s.hours.toFixed(2)}h</span>
                  </div>
                  <p className={styles.rowMeta}>
                    {s.shifts} shifts · {fmtMoney(s.gross)}
                  </p>
                </div>
                <span className={styles.rowChev} aria-hidden="true">›</span>
              </Link>
            </li>
          ))}
          {byStaff.length === 0 && <p className={styles.empty}>No staff shifts in this range.</p>}
        </ul>
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
                <p className={styles.modalSub}>Back-fill a missed clock-in / clock-out. Saved on our server only — not sent to Square.</p>
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
                    void load({ fresh: true });
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
function PayslipIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}
function PeopleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
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
