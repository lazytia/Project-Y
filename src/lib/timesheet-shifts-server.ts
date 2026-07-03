/**
 * Server-side timesheet shift aggregation for payroll push.
 * Merges Square Labor, local edits, and back-filled extra shifts.
 */
import { squareClient, squareEnv } from "@/lib/square";
import { adminDb } from "@/lib/firebase-admin";

export type TimesheetShift = {
  id: string;
  teamMemberId: string;
  dateISO: string;
  startAt: string;
  endAt: string | null;
  hours: number;
  hourlyRateCents: number | null;
};

export type TimesheetTeamMember = {
  firstName?: string;
  lastName?: string;
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
): Promise<{ shifts: TimesheetShift[]; teamMembers: Record<string, TimesheetTeamMember> }> {
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
          status?: string;
        }>;
        cursor?: string;
      };
      for (const m of page.teamMembers ?? []) {
        if (!m.id || (m.status && m.status !== "ACTIVE")) continue;
        teamMembers[m.id] = { firstName: m.givenName, lastName: m.familyName };
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
      const dateISO = startIso.slice(0, 10);
      const startMs = new Date(startIso).getTime();
      const endMs = endIso ? new Date(endIso).getTime() : null;
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
        startAt: startIso,
        endAt: endIso,
        hours: round2(paidMs / 3_600_000),
        hourlyRateCents,
      };
    })
    .filter((s) => s.dateISO >= startDate && s.dateISO <= endDate);

  return { shifts, teamMembers };
}

type EditDoc = { startAt?: string; endAt?: string; dateISO?: string };

function applyEdit(shift: TimesheetShift, edit: EditDoc | undefined): TimesheetShift {
  if (!edit?.startAt || !edit.endAt) return shift;
  const hours = round2(
    (new Date(edit.endAt).getTime() - new Date(edit.startAt).getTime()) / 3_600_000,
  );
  return {
    ...shift,
    startAt: edit.startAt,
    endAt: edit.endAt,
    hours: hours > 0 ? hours : 0,
  };
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
    };
  });
}

export async function fetchMergedTimesheetShifts(
  startDate: string,
  endDate: string,
): Promise<{
  shifts: TimesheetShift[];
  teamMembers: Record<string, TimesheetTeamMember>;
}> {
  const [{ shifts: squareShifts, teamMembers }, extras] = await Promise.all([
    fetchSquareShifts(startDate, endDate),
    fetchExtraShifts(startDate, endDate),
  ]);

  const editsSnap = await adminDb()
    .collection("timesheet_edits")
    .where("dateISO", ">=", startDate)
    .where("dateISO", "<=", endDate)
    .get();
  const edits: Record<string, EditDoc> = {};
  for (const d of editsSnap.docs) edits[d.id] = d.data() as EditDoc;

  const merged = [...squareShifts.map((s) => applyEdit(s, edits[s.id])), ...extras];
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
