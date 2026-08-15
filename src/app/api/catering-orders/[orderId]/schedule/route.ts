import { NextResponse, type NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { getPlatterCateringOrder } from "@/lib/catering-square";
import {
  clearScheduleOverride,
  getScheduleOverride,
  saveScheduleOverride,
} from "@/lib/catering-firestore";
import { toTimeLabel } from "@/lib/catering-orders";
import { isStrictOwnerEmail } from "@/lib/permissions";

/**
 * Owner-only date/time override for a catering job.
 *
 * Square stays the source of truth and is never mutated — the corrected
 * slot lives in Firestore (`catering_schedule/{squareOrderId}`) and is
 * overlaid on the Square order by the list and detail GET endpoints.
 */
async function verifyAuth(req: NextRequest) {
  const idToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!idToken) return { ok: false as const, status: 401, error: "Missing bearer token." };
  try {
    const decoded = await adminAuth().verifyIdToken(idToken);
    return { ok: true as const, email: decoded.email ?? null };
  } catch (err) {
    return {
      ok: false as const,
      status: 401,
      error: `Token verification failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/catering-orders/[orderId]/schedule
 * Returns the override, or null when the order still uses Square's own slot.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ orderId: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { orderId } = await ctx.params;
  const schedule = await getScheduleOverride(orderId);
  return NextResponse.json({ schedule });
}

/**
 * PUT /api/catering-orders/[orderId]/schedule
 * Body: { deliveryDateISO: "YYYY-MM-DD", deliveryTime: "HH:MM" (24h) }
 * Owner only. Writes Firestore only — Square is never touched.
 */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ orderId: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!isStrictOwnerEmail(auth.email)) {
    return NextResponse.json({ error: "Owner only." }, { status: 403 });
  }
  const { orderId } = await ctx.params;

  let body: { deliveryDateISO?: string; deliveryTime?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const deliveryDateISO = (body.deliveryDateISO ?? "").trim();
  if (!DATE_RE.test(deliveryDateISO) || Number.isNaN(Date.parse(`${deliveryDateISO}T00:00:00`))) {
    return NextResponse.json({ error: "deliveryDateISO must be YYYY-MM-DD." }, { status: 400 });
  }
  // The client sends the raw <input type="time"> value; we own the display
  // format so an edited order reads the same as a Square-sourced one.
  const deliveryTime = toTimeLabel(body.deliveryTime);
  if (!deliveryTime) {
    return NextResponse.json({ error: "deliveryTime must be HH:MM (24h)." }, { status: 400 });
  }

  const schedule = { deliveryDateISO, deliveryTime };
  try {
    await saveScheduleOverride(orderId, schedule, auth.email);
    return NextResponse.json({ ok: true, schedule });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to save schedule.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * DELETE /api/catering-orders/[orderId]/schedule
 * Owner only. Removes the override and answers with Square's own slot so
 * the client can show what it reverted to without a second round trip.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ orderId: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!isStrictOwnerEmail(auth.email)) {
    return NextResponse.json({ error: "Owner only." }, { status: 403 });
  }
  const { orderId } = await ctx.params;
  try {
    await clearScheduleOverride(orderId, auth.email);
    const order = await getPlatterCateringOrder(orderId);
    return NextResponse.json({
      ok: true,
      schedule: order
        ? { deliveryDateISO: order.deliveryDateISO, deliveryTime: order.deliveryTime }
        : null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to reset schedule.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
