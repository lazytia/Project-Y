import { NextResponse, type NextRequest } from "next/server";
import { callBooking, verifyAuth } from "@/lib/booking-api";
import {
  BLOCK_SEATINGS,
  BLOCK_TIMESLOTS,
  type BlockSeating,
  type BlockTimeslot,
  type BlockedDate,
} from "@/lib/reservations";

/**
 * Availability blocks on the booking platform.
 *
 *   GET  /api/reservations/blocked-dates?date=&branch= → blocks for that day
 *   GET  /api/reservations/blocked-dates?from=&branch= → that day onwards
 *   POST /api/reservations/blocked-dates               → create one
 *
 * The customer-facing booking site reads the same records and refuses any
 * slot they cover, which is what makes a block actually stop a booking
 * rather than just annotate our own screen.
 */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Upstream stores branch "all" as a wildcard, same as the booking site. */
function matchesBranch(block: BlockedDate, branch: string): boolean {
  const b = block.branch ?? "all";
  return b === "all" || b === branch;
}

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const url = new URL(req.url);
  const date = url.searchParams.get("date");
  const from = url.searchParams.get("from");
  const branch = url.searchParams.get("branch");

  const res = await callBooking<{ blockedDates?: BlockedDate[] }>("/blocked-dates");
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });

  // Upstream hands back every block it has ever stored, so narrow it here and
  // keep the payload proportional to what the caller asked for. Dates are
  // YYYY-MM-DD, which compares correctly as a plain string.
  let blocks = res.data?.blockedDates ?? [];
  if (date) blocks = blocks.filter((b) => b.date === date);
  if (from) blocks = blocks.filter((b) => b.date >= from);
  if (branch) blocks = blocks.filter((b) => matchesBranch(b, branch));

  return NextResponse.json({ blockedDates: blocks });
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const date = String(body.date ?? "");
  if (!DATE_RE.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD." }, { status: 400 });
  }

  const timeslot = String(body.timeslot ?? "all") as BlockTimeslot;
  if (!BLOCK_TIMESLOTS.includes(timeslot)) {
    return NextResponse.json({ error: `Unknown timeslot "${timeslot}".` }, { status: 400 });
  }

  const seating = String(body.seating ?? "all") as BlockSeating;
  if (!BLOCK_SEATINGS.includes(seating)) {
    return NextResponse.json({ error: `Unknown seating "${seating}".` }, { status: 400 });
  }

  // A custom block is the only shape that carries times, and the booking site
  // compares them as plain strings (start <= time <= end), so a reversed pair
  // would silently block nothing at all.
  let startTime: string | undefined;
  let endTime: string | undefined;
  if (timeslot === "custom") {
    startTime = String(body.startTime ?? "");
    endTime = String(body.endTime ?? "");
    if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) {
      return NextResponse.json({ error: "startTime and endTime must be HH:MM." }, { status: 400 });
    }
    if (startTime >= endTime) {
      return NextResponse.json({ error: "startTime must be before endTime." }, { status: 400 });
    }
  }

  const reason = String(body.reason ?? "").trim() || "Blocked";
  const branch = String(body.branch ?? "all");

  const res = await callBooking<{ id?: string }>("/blocked-dates", {
    method: "POST",
    body: { date, reason, branch, timeslot, seating, startTime, endTime },
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });

  return NextResponse.json({ id: res.data?.id });
}
