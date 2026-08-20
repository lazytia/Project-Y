import { NextResponse, type NextRequest } from "next/server";
import { callBooking, verifyAuth } from "@/lib/booking-api";

/** DELETE /api/reservations/blocked-dates/[id] — lift an availability block. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ blockId: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { blockId } = await ctx.params;
  if (!blockId) return NextResponse.json({ error: "Missing block id." }, { status: 400 });

  const res = await callBooking(`/blocked-dates/${encodeURIComponent(blockId)}`, {
    method: "DELETE",
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });

  return NextResponse.json({ success: true });
}
