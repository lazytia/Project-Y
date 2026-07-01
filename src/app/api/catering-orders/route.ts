import { NextResponse, type NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { listPlatterCateringOrders } from "@/lib/catering-square";
import { syncOrdersToFirestore } from "@/lib/catering-firestore";

/**
 * GET /api/catering-orders
 * Header: Authorization: Bearer <Firebase ID token>
 *
 * Returns every catering job from the Square Platter location (created
 * within the last 60 days or scheduled within the next 180), mapped into
 * the CateringOrder shape consumed by /operations/catering-orders.
 *
 * Read-only: orders are fetched from Square but never pushed back.
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
    syncOrdersToFirestore(orders);
    return NextResponse.json({ orders });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load Square orders.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST removed — catering orders are now read-only from Square.
// New orders should be created directly in Square.
