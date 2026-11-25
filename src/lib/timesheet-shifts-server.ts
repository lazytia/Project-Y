/**
 * Server-side timesheet shift aggregation.
 * Square Labor (read-only) + Firestore edits + app backfills.
 */
import { squareClient, squareEnv } from "@/lib/square";
import { adminDb } from "@/lib/firebase-admin";
import { rateForDateISO, readStaffRates, type StaffRates } from "@/lib/staff-rates";
import { snapClockWindow } from "@/lib/timesheet-rounding";
import { hoursOfWindow, isImplausibleClockWindow } from "@/lib/timesheet-window";

export type TimesheetShift = {
  id: string;
  teamMemberId: string;
  dateISO: string;
  /** Paid start — a Square clock-in snapped to the quarter-hour grid, or the
   *  exact time an owner set. */
  startAt: string;
  endAt: string | null;
  hours: number;
  hourlyRateCents: number | null;
  /** What the clock actually recorded, before snapping. Null for shifts that
   *  never went through the clock — owner backfills. Kept so the drill-down
   *  can show where a paid figure came from, and so every consumer of `hours`
   *  agrees on one rounded number instead of each rounding for itself. */
  clockedStartAt: string | null;
  clockedEndAt: string | null;
};

export type TimesheetTeamMember = {
  firstName?: string;
  lastName?: string;
  /**
   * Somebody Square no longer lists as active, whose name was filled in from
   * their own staff record. Their past shifts still have to read as theirs;
   * what they must not do is turn up in the add-shift picker as though they
   * could work another one.
   */
  inactive?: boolean;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function displayName(tm: TimesheetTeamMember | undefined, id: string): string {
  const first = (tm?.firstName ?? "").trim();
  const last = (tm?.lastName ?? "").trim();
  if (first || last) return `${first}${last ? " " + last : ""}`.trim();
  return id.slice(0, 8);
}

async function fetchSquareShifts(
  startDate: string,
  endDate: string,
): Promise<{
  shifts: TimesheetShift[];
  teamMembers: Record<string, TimesheetTeamMember>;
  /** Square `reference_id` — the 4-digit clock-in code. Stays server-side:
   *  `teamMembers` is serialised to the browser, this is a staff passcode. */
  staffIdByTeamMember: Record<string, string>;
}> {
  const { locationId } = squareEnv;
  if (!locationId) throw new Error("SQUARE_LOCATION_ID not set");

  const startUtc = new Date(`${startDate}T00:00:00Z`).getTime() - 24 * 3_600_000;
  const endUtc = new Date(`${endDate}T00:00:00Z`).getTime() + 48 * 3_600_000;
  const startAt = new Date(startUtc).toISOString();
  const endAt = new Date(endUtc).toISOString();

  type SquareShift = {
    id?: string;
    teamMemberId?: string;
    startAt?: string;
    endAt?: string;
    wage?: { hourlyRate?: { amount?: bigint | number } };
    breaks?: Array<{ startAt?: string; endAt?: string }>;
  };

  const raw: SquareShift[] = [];
  let cursor: string | undefined;
  do {
    const res = await squareClient.labor.shifts.search({
      query: {
        filter: {
          locationIds: [locationId],
          start: { startAt, endAt },
        },
        sort: { field: "START_AT", order: "DESC" },
      },
      cursor,
      limit: 200,
    });
    const page = res as unknown as { shifts?: SquareShift[]; cursor?: string };
    raw.push(...(page.shifts ?? []));
    cursor = page.cursor;
  } while (cursor);

  const teamMembers: Record<string, TimesheetTeamMember> = {};
  const staffIdByTeamMember: Record<string, string> = {};
  try {
    let tCursor: string | undefined;
    do {
      const res = await squareClient.teamMembers.search({
        query: { filter: { locationIds: [locationId], status: "ACTIVE" as never } },
        cursor: tCursor,
        limit: 200,
      });
      const page = res as unknown as {
        teamMembers?: Array<{
          id?: string;
          givenName?: string;
          familyName?: string;
          referenceId?: string;
          status?: string;
        }>;
        cursor?: string;
      };
      for (const m of page.teamMembers ?? []) {
        if (!m.id || (m.status && m.status !== "ACTIVE")) continue;
        teamMembers[m.id] = { firstName: m.givenName, lastName: m.familyName };
        const staffId = (m.referenceId ?? "").trim();
        if (staffId) staffIdByTeamMember[m.id] = staffId;
      }
      tCursor = page.cursor;
    } while (tCursor);
  } catch (err) {
    console.warn("[timesheet-shifts] team members lookup failed:", err);
  }

  const shifts = raw
    .filter((s) => s.startAt)
    .map((s) => {
      const startIso = s.startAt as string;
      const endIso = s.endAt ?? null;
      // Keep the shift on the day the employee turned up, even if snapping a
      // late clock-in rolls the paid start past midnight.
      const dateISO = startIso.slice(0, 10);
      // A clock-out nobody pressed is not a shift that ended. Square closes a
      // forgotten one for the employee at exactly 24 hours, and taking that at
      // face value pays a full day for an evening's work. Drop the end and
      // leave the row unpaid, the same as a shift still running: it stays on
      // the timesheet with the clock-in showing, and the owner types the
      // finish time they actually left at.
      const abandoned = isImplausibleClockWindow(startIso, endIso);
      const paid = snapClockWindow(startIso, abandoned ? null : endIso);
      const startMs = new Date(paid.startAt).getTime();
      const endMs = paid.endAt ? new Date(paid.endAt).getTime() : null;
      let breakMs = 0;
      for (const b of s.breaks ?? []) {
        if (!b.startAt || !b.endAt) continue;
        breakMs += new Date(b.endAt).getTime() - new Date(b.startAt).getTime();
      }
      const paidMs = endMs !== null ? Math.max(0, endMs - startMs - breakMs) : 0;
      const hourlyRateCents = s.wage?.hourlyRate?.amount
        ? Number(s.wage.hourlyRate.amount)
        : null;
      return {
        id: s.id ?? "",
        teamMemberId: s.teamMemberId ?? "",
        dateISO,
        startAt: paid.startAt,
        endAt: paid.endAt,
        hours: round2(paidMs / 3_600_000),
        hourlyRateCents,
        clockedStartAt: startIso,
        // The auto-close stamp is Square's bookkeeping, not something the
        // employee pressed, so it is not shown as their clock record. Keeping
        // it would put "4:59 PM – 4:59 PM" under the shift, which reads as a
        // clock-out at the same minute rather than as one that never came.
        clockedEndAt: abandoned ? null : endIso,
      };
    })
    .filter((s) => s.dateISO >= startDate && s.dateISO <= endDate);

  return { shifts, teamMembers, staffIdByTeamMember };
}

type EditDoc = { startAt?: string; endAt?: string; dateISO?: string };

/** An owner correction replaces the paid window as typed — deliberately not
 *  re-snapped — while the clocked times underneath stay for the audit trail. */
function applyEdit(shift: TimesheetShift, edit: EditDoc | undefined): TimesheetShift {
  if (!edit?.startAt || !edit.endAt) return shift;
  return {
    ...shift,
    startAt: edit.startAt,
    endAt: edit.endAt,
    hours: hoursOfWindow(edit.startAt, edit.endAt),
  };
}

/**
 * Square team members who clock in at the till but are not on this payroll —
 * an owner punching the clock alongside the staff, or a device left logged in
 * under a test account. Their shifts are real in Square and stay there; the
 * app just declines to price them.
 *
 * Kept as data rather than a name in this file: who is and isn't on payroll is
 * the owner's call and changes with the roster, and a hardcoded name would
 * quietly keep excluding whoever inherited it.
 *
 * Doc id is the Square team member id.
 */
async function fetchExcludedTeamMemberIds(): Promise<Set<string>> {
  try {
    const snap = await adminDb().collection("timesheet_excluded_team_members").get();
    return new Set(snap.docs.map((d) => d.id));
  } catch (err) {
    // Excluding nobody shows too many people; failing the whole timesheet
    // shows none. The first is recoverable by looking, so carry on.
    console.warn("[timesheet-shifts] excluded team member lookup failed:", err);
    return new Set<string>();
  }
}

async function fetchDismissedShiftIds(startDate: string, endDate: string): Promise<Set<string>> {
  const snap = await adminDb()
    .collection("timesheet_dismissed")
    .where("dateISO", ">=", startDate)
    .where("dateISO", "<=", endDate)
    .get();
  return new Set(snap.docs.map((d) => d.id));
}

async function fetchExtraShifts(startDate: string, endDate: string): Promise<TimesheetShift[]> {
  const db = adminDb();
  const extrasSnap = await db
    .collection("timesheet_extra_shifts")
    .where("dateISO", ">=", startDate)
    .where("dateISO", "<=", endDate)
    .get();

  return extrasSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      teamMemberId: String(data.teamMemberId ?? ""),
      dateISO: String(data.dateISO ?? ""),
      startAt: String(data.startAt ?? ""),
      endAt: data.endAt ? String(data.endAt) : null,
      hours: typeof data.hours === "number" ? round2(data.hours) : 0,
      hourlyRateCents:
        typeof data.hourlyRateCents === "number" ? data.hourlyRateCents : null,
      // Backfills were typed in, never clocked — nothing to snap or trace.
      clockedStartAt: null,
      clockedEndAt: null,
    };
  });
}

type StaffRateIndex = {
  byTeamMemberId: Record<string, StaffRates>;
  byStaffId: Record<string, StaffRates>;
  /** Names off the same records, for shifts Square can no longer name. */
  nameByTeamMemberId: Record<string, TimesheetTeamMember>;
  nameByStaffId: Record<string, TimesheetTeamMember>;
};

/** The employee's name as their own record holds it, or null if it has none. */
function nameFromStaffDoc(raw: Record<string, unknown>): TimesheetTeamMember | null {
  const first = typeof raw.firstName === "string" ? raw.firstName.trim() : "";
  const last = typeof raw.lastName === "string" ? raw.lastName.trim() : "";
  if (first || last) {
    return { firstName: first || undefined, lastName: last || undefined, inactive: true };
  }
  const full = typeof raw.fullName === "string" ? raw.fullName.trim() : "";
  if (!full) return null;
  const [firstWord, ...rest] = full.split(/\s+/);
  return { firstName: firstWord, lastName: rest.join(" ") || undefined, inactive: true };
}

/**
 * Rates are owned by the app, but shifts arrive keyed by Square team member,
 * so each employee has to be recognisable from their shift. `squareTeamMemberId`
 * is the explicit link; most employees only ever get a 4-digit clock-in code,
 * so that is indexed too and matched against Square's `reference_id`.
 */
async function fetchStaffRates(): Promise<StaffRateIndex> {
  const byTeamMemberId: Record<string, StaffRates> = {};
  const byStaffId: Record<string, StaffRates> = {};
  const nameByTeamMemberId: Record<string, TimesheetTeamMember> = {};
  const nameByStaffId: Record<string, TimesheetTeamMember> = {};
  const sharedStaffIds = new Set<string>();
  try {
    const snap = await adminDb().collection("staff_onboarding").get();
    for (const d of snap.docs) {
      const raw = d.data() as Record<string, unknown>;
      const rates = readStaffRates(raw);
      const name = nameFromStaffDoc(raw);
      const teamMemberId =
        typeof raw.squareTeamMemberId === "string" ? raw.squareTeamMemberId.trim() : "";
      if (teamMemberId) {
        byTeamMemberId[teamMemberId] = rates;
        if (name) nameByTeamMemberId[teamMemberId] = name;
      }

      const staffId = typeof raw.squareStaffId === "string" ? raw.squareStaffId.trim() : "";
      if (!staffId) continue;
      if (staffId in byStaffId) sharedStaffIds.add(staffId);
      byStaffId[staffId] = rates;
      if (name) nameByStaffId[staffId] = name;
    }
  } catch (err) {
    console.warn("[timesheet-shifts] staff rates lookup failed:", err);
  }
  // Two employees on one code means a shift can't be attributed to either.
  // Paying the wrong rate is worse than falling back to the Square wage.
  for (const staffId of sharedStaffIds) {
    delete byStaffId[staffId];
    delete nameByStaffId[staffId];
  }
  return { byTeamMemberId, byStaffId, nameByTeamMemberId, nameByStaffId };
}

function resolveRatesByTeamMember(
  staffIdByTeamMember: Record<string, string>,
  index: StaffRateIndex,
): Record<string, StaffRates> {
  const out: Record<string, StaffRates> = { ...index.byTeamMemberId };
  for (const [teamMemberId, staffId] of Object.entries(staffIdByTeamMember)) {
    if (out[teamMemberId]) continue;
    const rates = index.byStaffId[staffId];
    if (rates) out[teamMemberId] = rates;
  }
  return out;
}

/**
 * The wage Square reports is whatever was on the team member when the shift
 * was clocked, and it cannot vary by day. Prefer the rate the owner set on
 * the employee's profile, and only fall back to Square when none is set.
 */
function applyConfiguredRate(
  shift: TimesheetShift,
  rates: StaffRates | undefined,
): TimesheetShift {
  const rate = rateForDateISO(rates, shift.dateISO);
  if (rate == null) return shift;
  return { ...shift, hourlyRateCents: Math.round(rate * 100) };
}

export async function fetchMergedTimesheetShifts(
  startDate: string,
  endDate: string,
): Promise<{
  shifts: TimesheetShift[];
  teamMembers: Record<string, TimesheetTeamMember>;
}> {
  const [
    { shifts: squareShifts, teamMembers, staffIdByTeamMember },
    extras,
    dismissedIds,
    rateIndex,
    excludedTeamMemberIds,
  ] = await Promise.all([
    fetchSquareShifts(startDate, endDate),
    fetchExtraShifts(startDate, endDate),
    fetchDismissedShiftIds(startDate, endDate),
    fetchStaffRates(),
    fetchExcludedTeamMemberIds(),
  ]);
  const staffRates = resolveRatesByTeamMember(staffIdByTeamMember, rateIndex);

  // Drop them from the roster as well as the shifts. Leaving the name behind
  // would still list them with zero hours, and would still offer them in the
  // add-shift picker — which is how an excluded person gets back in.
  for (const id of excludedTeamMemberIds) delete teamMembers[id];

  const editsSnap = await adminDb()
    .collection("timesheet_edits")
    .where("dateISO", ">=", startDate)
    .where("dateISO", "<=", endDate)
    .get();
  const edits: Record<string, EditDoc> = {};
  for (const d of editsSnap.docs) edits[d.id] = d.data() as EditDoc;

  const merged = [...squareShifts.map((s) => applyEdit(s, edits[s.id])), ...extras]
    .filter((s) => !dismissedIds.has(s.id) && !excludedTeamMemberIds.has(s.teamMemberId))
    .map((s) => applyConfiguredRate(s, staffRates[s.teamMemberId]));

  // Name whoever Square no longer lists, from their own staff record.
  //
  // The team-member lookup above asks Square for active staff only, so the
  // day somebody is deactivated there — which is what happens when they
  // leave — every shift they ever worked lost its name and the timesheet
  // started calling them by the first eight characters of an id. The work
  // was still theirs and the pay still had to go somewhere, so the hours had
  // to stay; it was only the name that went. Their record here still has it.
  for (const shift of merged) {
    const id = shift.teamMemberId;
    if (!id || teamMembers[id]) continue;
    const name =
      rateIndex.nameByTeamMemberId[id] ??
      rateIndex.nameByStaffId[staffIdByTeamMember[id] ?? ""];
    if (name) teamMembers[id] = name;
  }

  return { shifts: merged, teamMembers };
}

export function aggregateHoursByTeamMember(
  shifts: TimesheetShift[],
  teamMembers: Record<string, TimesheetTeamMember>,
  premiumDayOfWeek: 0 | 6,
): Map<
  string,
  { displayName: string; weekHours: number; premiumHours: number; totalHours: number }
> {
  const out = new Map<
    string,
    { displayName: string; weekHours: number; premiumHours: number; totalHours: number }
  >();

  for (const s of shifts) {
    if (!s.teamMemberId || s.hours <= 0) continue;
    const [y, m, d] = s.dateISO.split("-").map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() as 0 | 6 | number;

    const cur = out.get(s.teamMemberId) ?? {
      displayName: displayName(teamMembers[s.teamMemberId], s.teamMemberId),
      weekHours: 0,
      premiumHours: 0,
      totalHours: 0,
    };

    if (dow === premiumDayOfWeek) cur.premiumHours += s.hours;
    else cur.weekHours += s.hours;
    cur.totalHours += s.hours;
    out.set(s.teamMemberId, cur);
  }

  for (const [id, v] of out) {
    out.set(id, {
      ...v,
      weekHours: round2(v.weekHours),
      premiumHours: round2(v.premiumHours),
      totalHours: round2(v.totalHours),
    });
  }
  return out;
}

export { displayName as teamMemberDisplayName };
