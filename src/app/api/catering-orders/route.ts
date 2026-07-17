import { NextResponse, type NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import {
  createPlatterCateringOrder,
  createPlatterCateringOrderFromForm,
  listPlatterCateringOrders,
} from "@/lib/catering-square";
import {
  fetchHiddenOrderIds,
  syncOrderToFirestore,
  syncOrdersToFirestore,
} from "@/lib/catering-firestore";
import type { CateringOrderForm } from "@/lib/catering-orders";

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
    const [orders, hiddenIds] = await Promise.all([
      listPlatterCateringOrders(),
      fetchHiddenOrderIds(),
    ]);
    // Filter out orders the owner has hidden in our app (Square is
    // the source of truth and stays untouched — we only skip these
    // from the calendar view).
    const visible = hiddenIds.size > 0
      ? orders.filter((o) => !hiddenIds.has(o.id))
      : orders;
    syncOrdersToFirestore(visible);
    return NextResponse.json({ orders: visible });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load Square orders.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: Partial<CateringOrderForm> & {
    totalAmount?: number;
    guestsCount?: number;
    notes?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body.clientName || !body.deliveryDateISO || !body.deliveryTime) {
    return NextResponse.json(
      { error: "Required: clientName, deliveryDateISO, deliveryTime." },
      { status: 400 },
    );
  }
  try {
    // New-form path: itemised + fulfilment type + contact metadata.
    if (Array.isArray(body.items)) {
      const order = await createPlatterCateringOrderFromForm({
        clientName: body.clientName,
        companyName: body.companyName,
        contactPhone: body.contactPhone,
        contactEmail: body.contactEmail,
        orderMethod: body.orderMethod ?? "OTHER",
        fulfillmentType: body.fulfillmentType ?? "PICKUP",
        deliveryDateISO: body.deliveryDateISO,
        deliveryTime: body.deliveryTime,
        readyByTime: body.readyByTime,
        deliveryAddress: body.deliveryAddress,
        items: body.items,
        dietaryNotes: body.dietaryNotes,
        utensilsCount: body.utensilsCount,
        paymentStatus: body.paymentStatus,
      });
      syncOrderToFirestore(order, "created");
      return NextResponse.json({ order });
    }
    // Legacy quick-add path from the day modal.
    if (!body.totalAmount) {
      return NextResponse.json(
        { error: "Required for quick-add: totalAmount." },
        { status: 400 },
      );
    }
    const order = await createPlatterCateringOrder({
      clientName: body.clientName,
      deliveryDateISO: body.deliveryDateISO,
      deliveryTime: body.deliveryTime,
      guestsCount: body.guestsCount ?? 0,
      totalAmount: body.totalAmount,
      notes: body.notes ?? "",
    });
    syncOrderToFirestore(order, "created");
    return NextResponse.json({ order });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create Square order.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
