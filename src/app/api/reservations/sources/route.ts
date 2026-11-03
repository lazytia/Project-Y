import { NextResponse, type NextRequest } from "next/server";
import { callBooking, verifyAuth } from "@/lib/booking-api";
import { isStrictOwnerEmail } from "@/lib/permissions";
import {
  BOOKING_SOURCE_PERIODS,
  DEFAULT_BOOKING_SOURCE_PERIOD,
  type BookingSourcePeriod,
  type BookingSourceSummary,
} from "@/lib/booking-sources";

/**
 * GET /api/reservations/sources?days=7|30|90 → booking counts per source.
 *
 * Owner only, matching the page. The numbers come from the booking
 * platform, which counts bookings by when they were made.
 */
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!isStrictOwnerEmail(auth.email)) {
    return NextResponse.json({ error: "Owner only." }, { status: 403 });
  }

  const requested = Number(new URL(req.url).searchParams.get("days"));
  const days = BOOKING_SOURCE_PERIODS.includes(requested as BookingSourcePeriod)
    ? requested
    : DEFAULT_BOOKING_SOURCE_PERIOD;

  const res = await callBooking<BookingSourceSummary>(`/reservations/source-summary?days=${days}`);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json(res.data);
}
