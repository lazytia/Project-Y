import { NextResponse, type NextRequest } from "next/server";
import { squareClient, squareEnv } from "@/lib/square";

/**
 * GET /api/square/timesheets?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 *
 * Returns every Square Labor "Shift" (clock-in / clock-out record) that
 * intersects the requested date range at the configured location, along
 * with a lookup table of team members so the client can render names.
 *
 * Response:
 *   {
 *     shifts: Array<{
 *       id: string;
 *       teamMemberId: string;
 *       dateISO: string;               // shift start's LOCAL calendar day
 *       startAt: string;               // ISO in Sydney local ("...+10:00")
 *       endAt: string | null;          // null while the shift is still open
 *       hours: number;                 // paid hours (breaks excluded)
 *       hourlyRateCents: number | null;
 *     }>,
 *     teamMembers: Record<string, { firstName?: string; lastName?: string }>,
 *     locationId: string,
 *     timezone: string,
 *   }
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const startDate = url.searchParams.get("startDate") ?? "";
  const endDate = url.searchParams.get("endDate") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return NextResponse.json(
      { error: "Pass ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD" },
      { status: 400 },
    );
  }
  const { locationId, timezone } = squareEnv;
  if (!locationId) {
    return NextResponse.json({ error: "SQUARE_LOCATION_ID not set" }, { status: 500 });
  }

  try {
    // Square's shift search wants ISO instants. Convert the requested
    // local-calendar range into UTC bounds sitting well outside the day
    // so we catch shifts that started late the previous day. Local-day
    // classification then happens client-side against the returned local
    // start-time.
    const startUtc = new Date(`${startDate}T00:00:00Z`).getTime() - 24 * 3_600_000;
    const endUtc = new Date(`${endDate}T00:00:00Z`).getTime() + 48 * 3_600_000;
    const startAt = new Date(startUtc).toISOString();
    const endAt = new Date(endUtc).toISOString();

    // 1) Paginate shifts across the range.
    type SquareShift = {
      id?: string;
      teamMemberId?: string;
      startAt?: string;
      endAt?: string;
      timezone?: string;
      wage?: { hourlyRate?: { amount?: bigint | number } };
      breaks?: Array<{ startAt?: string; endAt?: string }>;
    };
    const shifts: SquareShift[] = [];
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
      const page = (res as unknown as { shifts?: SquareShift[]; cursor?: string });
      shifts.push(...(page.shifts ?? []));
      cursor = page.cursor;
    } while (cursor);

    // 2) Team members — one call, keyed by id.
    type SquareTeamMember = { id?: string; givenName?: string; familyName?: string };
    const teamMembers: Record<string, { firstName?: string; lastName?: string }> = {};
    try {
      let tCursor: string | undefined;
      do {
        const res = await squareClient.teamMembers.search({
          query: { filter: { locationIds: [locationId] } },
          cursor: tCursor,
          limit: 200,
        });
        const page = (res as unknown as { teamMembers?: SquareTeamMember[]; cursor?: string });
        for (const m of page.teamMembers ?? []) {
          if (!m.id) continue;
          teamMembers[m.id] = { firstName: m.givenName, lastName: m.familyName };
        }
        tCursor = page.cursor;
      } while (tCursor);
    } catch (err) {
      console.warn("[square/timesheets] team members lookup failed:", err);
    }

    // 3) Normalise shifts. Local calendar day is derived from a Sydney-
    // local ISO string returned by Square (they format startAt with the
    // location's offset, e.g. "2026-06-22T09:30:00+10:00").
    const out = shifts
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
        const hours = paidMs / 3_600_000;
        const hourlyRateCents = s.wage?.hourlyRate?.amount
          ? Number(s.wage.hourlyRate.amount)
          : null;
        return {
          id: s.id ?? "",
          teamMemberId: s.teamMemberId ?? "",
          dateISO,
          startAt: startIso,
          endAt: endIso,
          hours: Math.round(hours * 100) / 100,
          hourlyRateCents,
        };
      });

    return NextResponse.json({
      shifts: out,
      teamMembers,
      locationId,
      timezone: timezone ?? "UTC",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Square Labor unreachable.";
    console.error("[square/timesheets] failed:", err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
