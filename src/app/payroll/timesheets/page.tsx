"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, getDocs, doc, getDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { isOwner } from "@/lib/permissions";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

/*
 * Timesheets — labour hours + estimated gross pay across a date range.
 *
 * Data model:
 *   rosters_published/{weekMondayISO}.assignments[dateISO][meal][uid] = "HH:MM"
 *   staff_onboarding/{uid}.hourlyRate | .weekRate | .weeklyRate
 *
 * The roster only stores shift START times, not durations, so we treat
 * each meal as a fixed-length block:
 *   LUNCH   → 4 hours
 *   DINNER  → 5 hours
 * Anything else falls back to LUNCH_HOURS. If the business later moves
 * to true clock-in/clock-out logging these constants can go.
 */

const SYDNEY_TZ = "Australia/Sydney";
const LUNCH_HOURS = 4;
const DINNER_HOURS = 5;
const WEEK_TO_HOURS = 38; // used only when a weekly rate exists

type AssignmentDoc = {
  assignments?: Record<string, Record<string, Record<string, string>>>;
};

type StaffDoc = {
  firstName?: string;
  lastName?: string;
  hourlyRate?: number;
  weekRate?: number;
  weeklyRate?: number;
};

type DayRow = {
  dateISO: string;
  staff: number;
  shifts: number;
  hours: number;
  gross: number;
};

type StaffRow = {
  uid: string;
  name: string;
  shifts: number;
  hours: number;
  gross: number;
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
  const dow = (dt.getUTCDay() + 6) % 7; // Mon = 0
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

function fmtLongDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
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
  const startLabel = start.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const endLabel = end.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${startLabel} – ${endLabel}`;
}

function fmtHours(h: number): string {
  return `${h.toFixed(2)}h`;
}

function fmtMoney(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ── rate resolver ───────────────────────────────────────────────── */

function hourlyRateOf(s: StaffDoc | undefined): number {
  if (!s) return 0;
  if (typeof s.hourlyRate === "number" && s.hourlyRate > 0) return s.hourlyRate;
  const weekly =
    (typeof s.weekRate === "number" ? s.weekRate : undefined) ??
    (typeof s.weeklyRate === "number" ? s.weeklyRate : undefined);
  if (typeof weekly === "number" && weekly > 0) return weekly / WEEK_TO_HOURS;
  return 0;
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
  const [rosters, setRosters] = useState<Record<string, AssignmentDoc>>({});
  const [staffMap, setStaffMap] = useState<Record<string, StaffDoc>>({});

  // Default range on mount: current Sydney week Mon → Sun. Owner overrides
  // via the Start / End date pickers.
  useEffect(() => {
    const today = sydneyTodayISO();
    const mon = isoMondayOf(today);
    setStartISO(mon);
    setEndISO(isoSundayOfWeek(mon));
  }, []);

  const load = useCallback(async () => {
    if (!startISO || !endISO) return;
    setBusy(true);
    try {
      // Pull every roster week that overlaps the selected range. The
      // week key is the Monday ISO of the first day the doc covers.
      const startMon = isoMondayOf(startISO);
      const endMon = isoMondayOf(endISO);
      const weekKeys: string[] = [];
      let cur = startMon;
      while (cur <= endMon) {
        weekKeys.push(cur);
        cur = addDaysISO(cur, 7);
      }
      const rosterEntries = await Promise.all(
        weekKeys.map(async (k) => {
          const snap = await getDoc(doc(getDb(), "rosters_published", k));
          return [k, snap.exists() ? (snap.data() as AssignmentDoc) : {}] as const;
        }),
      );
      const rosterMap: Record<string, AssignmentDoc> = {};
      for (const [k, v] of rosterEntries) rosterMap[k] = v;
      setRosters(rosterMap);

      // Staff rates + names — one collection scan is cheap enough given
      // the staff table is small.
      const staffSnap = await getDocs(collection(getDb(), "staff_onboarding"));
      const sMap: Record<string, StaffDoc> = {};
      for (const d of staffSnap.docs) sMap[d.id] = d.data() as StaffDoc;
      setStaffMap(sMap);
    } finally {
      setBusy(false);
      setLoading(false);
    }
  }, [startISO, endISO]);

  useEffect(() => {
    if (authLoading || !allowed) return;
    void load();
  }, [authLoading, allowed, load]);

  // Fold assignments into per-day and per-staff aggregates.
  const { days, byStaff, totalHours, totalGross, totalShifts, totalStaff } = useMemo(() => {
    const days: DayRow[] = [];
    const staffAgg: Record<string, StaffRow> = {};
    let totalHours = 0;
    let totalGross = 0;
    let totalShifts = 0;
    const allStaffUids = new Set<string>();

    if (!startISO || !endISO) {
      return { days, byStaff: [] as StaffRow[], totalHours, totalGross, totalShifts, totalStaff: 0 };
    }

    for (const dateISO of eachDayISO(startISO, endISO)) {
      const weekKey = isoMondayOf(dateISO);
      const dayAssignments = rosters[weekKey]?.assignments?.[dateISO] ?? {};
      let dShifts = 0;
      let dHours = 0;
      let dGross = 0;
      const dStaff = new Set<string>();

      for (const [meal, uids] of Object.entries(dayAssignments)) {
        const key = meal.toLowerCase();
        const perShift = key.includes("dinner") ? DINNER_HOURS : LUNCH_HOURS;
        for (const uid of Object.keys(uids)) {
          const rate = hourlyRateOf(staffMap[uid]);
          const gross = perShift * rate;
          dShifts += 1;
          dHours += perShift;
          dGross += gross;
          dStaff.add(uid);
          allStaffUids.add(uid);

          const row = (staffAgg[uid] ??= {
            uid,
            name: nameOfStaff(uid, staffMap[uid]),
            shifts: 0,
            hours: 0,
            gross: 0,
          });
          row.shifts += 1;
          row.hours += perShift;
          row.gross += gross;
        }
      }

      days.push({ dateISO, staff: dStaff.size, shifts: dShifts, hours: dHours, gross: dGross });
      totalShifts += dShifts;
      totalHours += dHours;
      totalGross += dGross;
    }

    return {
      days,
      byStaff: Object.values(staffAgg).sort((a, b) => b.hours - a.hours),
      totalHours,
      totalGross,
      totalShifts,
      totalStaff: allStaffUids.size,
    };
  }, [rosters, staffMap, startISO, endISO]);

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
          <span className={styles.summaryIcon}>
            <ClockIcon />
          </span>
          <div>
            <p className={styles.summaryLabel}>TOTAL PAID HOURS</p>
            <p className={styles.summaryValue}>
              {totalHours.toFixed(2)} <span className={styles.summaryUnit}>h</span>
            </p>
            <p className={styles.summarySub}>
              {totalStaff} staff · {totalShifts} shifts
            </p>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryIcon}>
            <DollarIcon />
          </span>
          <div>
            <p className={styles.summaryLabel}>EST. GROSS PAY</p>
            <p className={styles.summaryValue}>{fmtMoney(totalGross)}</p>
            <p className={styles.summarySub}>Shift rate × paid hours</p>
          </div>
        </div>
      </section>

      <section className={styles.filterCard}>
        <div className={styles.rangeGrid}>
          <label className={styles.rangeField}>
            <span className={styles.rangeLabel}>Start</span>
            <span className={styles.rangeInput}>
              <CalIconSm />
              <input
                type="date"
                value={startISO}
                onChange={(e) => setStartISO(e.target.value)}
                aria-label="Start date"
              />
              <span className={styles.rangeInputText}>{startISO ? fmtDayLabel(startISO) + " " + startISO.slice(0, 4) : "—"}</span>
            </span>
          </label>
          <label className={styles.rangeField}>
            <span className={styles.rangeLabel}>End</span>
            <span className={styles.rangeInput}>
              <CalIconSm />
              <input
                type="date"
                value={endISO}
                onChange={(e) => setEndISO(e.target.value)}
                aria-label="End date"
              />
              <span className={styles.rangeInputText}>{endISO ? fmtDayLabel(endISO) + " " + endISO.slice(0, 4) : "—"}</span>
            </span>
          </label>
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

      <div className={styles.summaryHeader}>
        <p className={styles.sectionEyebrow}>BY {view === "day" ? "DAY" : "STAFF"} SUMMARY</p>
        <Link href="/scheduling/roster" className={styles.viewCalLink}>
          <CalIconSm /> View calendar
        </Link>
      </div>

      <div className={styles.actionRow}>
        <div className={styles.viewToggle} role="tablist" aria-label="View mode">
          <button
            type="button"
            role="tab"
            aria-selected={view === "day"}
            className={`${styles.toggleBtn} ${view === "day" ? styles.toggleBtnActive : ""}`}
            onClick={() => setView("day")}
          >
            Day
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "staff"}
            className={`${styles.toggleBtn} ${view === "staff" ? styles.toggleBtnActive : ""}`}
            onClick={() => setView("staff")}
          >
            Staff
          </button>
        </div>
        <Link href="/scheduling/roster" className={styles.addShiftBtn}>
          + Add shift
        </Link>
        <button type="button" className={styles.refreshBtn} onClick={() => void load()} disabled={busy}>
          <RefreshIcon /> Refresh
        </button>
      </div>

      {view === "day" ? (
        <ul className={styles.list}>
          {days.map((d) => {
            const chip = fmtDayChip(d.dateISO);
            return (
              <li key={d.dateISO} className={styles.row}>
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
              </li>
            );
          })}
          {days.length === 0 && <p className={styles.empty}>No shifts in this range.</p>}
        </ul>
      ) : (
        <ul className={styles.list}>
          {byStaff.map((s) => (
            <li key={s.uid} className={styles.row}>
              <span className={styles.avatar} aria-hidden="true">
                {initials(s.name)}
              </span>
              <div className={styles.rowBody}>
                <p className={styles.rowTitle}>{s.name}</p>
                <p className={styles.rowMeta}>
                  {s.shifts} shifts · {fmtMoney(s.gross)}
                </p>
              </div>
              <span className={styles.rowValue}>{fmtHours(s.hours)}</span>
              <span className={styles.rowChev} aria-hidden="true">›</span>
            </li>
          ))}
          {byStaff.length === 0 && <p className={styles.empty}>No staff shifts in this range.</p>}
        </ul>
      )}

      <div className={styles.footNote}>
        <InfoIcon /> Hours shown are estimated paid hours (lunch = {LUNCH_HOURS}h, dinner = {DINNER_HOURS}h). Breaks are excluded.
      </div>
    </div>
  );
}

/* ── helpers ─────────────────────────────────────────────────────── */

function nameOfStaff(uid: string, s: StaffDoc | undefined): string {
  const first = (s?.firstName ?? "").trim();
  const last = (s?.lastName ?? "").trim();
  if (first || last) return `${first}${last ? " " + last : ""}`;
  return uid.slice(0, 6);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const a = (parts[0]?.[0] ?? "?").toUpperCase();
  const b = (parts[1]?.[0] ?? "").toUpperCase();
  return (a + b) || "??";
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
function DollarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
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
function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}
