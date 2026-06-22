import { NextResponse, type NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import {
  cancelPlatterCateringOrder,
  getPlatterCateringOrder,
  updatePlatterCateringOrder,
} from "@/lib/catering-square";
import type { CateringOrderForm } from "@/lib/catering-orders";

/**
 * GET /api/catering-orders/[orderId]
 * Header: Authorization: Bearer <Firebase ID token>
 *
 * Returns one catering job by Square order id, mapped into the
 * CateringOrder shape used by /operations/catering-orders/[orderId].
 */
async function verifyAuth(req: NextRequest) {
  const idToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!idToken) return { ok: false as const, status: 401, error: "Missing bearer token." };
  try {
    await adminAuth().verifyIdToken(idToken);
    return { ok: true as const };
  } catch (err) {
    return {
      ok: false as const,
      status: 401,
      error: `Token verification failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ orderId: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { orderId } = await ctx.params;
  try {
    const order = await getPlatterCateringOrder(orderId);
    if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
    return NextResponse.json({ order });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load Square order.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ orderId: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { orderId } = await ctx.params;
  let body: Partial<CateringOrderForm>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  try {
    const order = await updatePlatterCateringOrder(orderId, body);
    return NextResponse.json({ order });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to update Square order.";
    const detail =
      err && typeof err === "object"
        ? JSON.stringify(err, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
        : undefined;
    console.error("[catering-orders] PATCH failed:", detail ?? msg);
    return NextResponse.json({ error: msg, detail }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ orderId: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { orderId } = await ctx.params;
  try {
    await cancelPlatterCateringOrder(orderId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to cancel Square order.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
