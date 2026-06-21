import { NextResponse, type NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { createPlatterCateringOrder, listPlatterCateringOrders } from "@/lib/catering-square";

/**
 * GET /api/catering-orders
 * Header: Authorization: Bearer <Firebase ID token>
 *
 * Returns every catering job from the Square Platter location (created
 * within the last 60 days or scheduled within the next 180), mapped into
 * the CateringOrder shape consumed by /operations/catering-orders.
 */
async function verifyAuth(req: NextRequest): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const idToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!idToken) return { ok: false, status: 401, error: "Missing bearer token." };
  try {
    await adminAuth().verifyIdToken(idToken);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      status: 401,
      error: `Token verification failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const orders = await listPlatterCateringOrders();
    return NextResponse.json({ orders });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load Square orders.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: {
    clientName?: string;
    deliveryDateISO?: string;
    deliveryTime?: string;
    guestsCount?: number;
    totalAmount?: number;
    notes?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body.clientName || !body.deliveryDateISO || !body.deliveryTime || !body.totalAmount) {
    return NextResponse.json(
      { error: "Required: clientName, deliveryDateISO, deliveryTime, totalAmount." },
      { status: 400 },
    );
  }
  try {
    const order = await createPlatterCateringOrder({
      clientName: body.clientName,
      deliveryDateISO: body.deliveryDateISO,
      deliveryTime: body.deliveryTime,
      guestsCount: body.guestsCount ?? 0,
      totalAmount: body.totalAmount,
      notes: body.notes ?? "",
    });
    return NextResponse.json({ order });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create Square order.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
