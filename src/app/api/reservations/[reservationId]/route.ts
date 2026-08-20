import { NextResponse, type NextRequest } from "next/server";
import { callBooking, verifyAuth } from "@/lib/booking-api";

/**
 * PUT /api/reservations/[id] → update via booking platform.
 */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ reservationId: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { reservationId } = await ctx.params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }
  const res = await callBooking(`/reservations/${encodeURIComponent(reservationId)}`, {
    method: "PUT",
    body,
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json(res.data);
}
