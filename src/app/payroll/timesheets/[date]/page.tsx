"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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

  const load = useCallback(async () => {
    if (!dateISO) return;
    setBusy(true);
    setFetchError(null);
    try {
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
    return shifts
      .filter((s) => s.dateISO === dateISO && !dismissed.has(s.id))
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
  }, [shifts, dismissed, dateISO]);

  const totalHours = useMemo(
    () => visibleShifts.reduce((sum, s) => sum + s.hours, 0),
    [visibleShifts],
  );


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
          onClick={() => alert("Add-shift is not wired to Square Labor yet.")}
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

      <ul className={styles.shiftList}>
        {visibleShifts.length === 0 && !busy ? (
          <li className={styles.emptyRow}>No shifts recorded for this day.</li>
        ) : (
          visibleShifts.map((s) => {
            const name = nameOfTeamMember(s.teamMemberId, teamMembers[s.teamMemberId]);
            const start = fmtClockTime(s.startAt);
            const end = fmtClockTime(s.endAt);
            return (
              <li key={s.id} className={styles.shiftCard}>
                <span className={styles.avatar} aria-hidden="true">{initials(name)}</span>
                <div className={styles.shiftBody}>
                  <p className={styles.shiftName}>{name}</p>
                  <div className={styles.timeRow}>
                    <span className={styles.timeChip}>
                      <span className={styles.timeChipMain}>{start.hhmm}</span>
                      <span className={styles.timeChipAmpm}>{start.ampm}</span>
                    </span>
                    <span className={styles.timeSep}>—</span>
                    <span className={styles.timeChip}>
                      <span className={styles.timeChipMain}>{end.hhmm}</span>
                      <span className={styles.timeChipAmpm}>{end.ampm}</span>
                    </span>
                  </div>
                  <p className={styles.editNote}>No edits</p>
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
        onClick={() => alert("Add-shift is not wired to Square Labor yet.")}
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
    </div>
  );
}
