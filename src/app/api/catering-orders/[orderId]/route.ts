import { NextResponse, type NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { getPlatterCateringOrder } from "@/lib/catering-square";
import { hideCateringOrder, syncOrderToFirestore } from "@/lib/catering-firestore";
import { isStrictOwnerEmail } from "@/lib/permissions";

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

/** Strict owners (Tia / Yurica / Eddie) — managers and chefs excluded. */
function isStrictOwnerFromAuth(email: string | null): boolean {
  return isStrictOwnerEmail(email);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ orderId: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { orderId } = await ctx.params;
  try {
    const order = await getPlatterCateringOrder(orderId);
    if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
    syncOrderToFirestore(order, "fetched");
    return NextResponse.json({ order });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load Square order.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PATCH removed — catering orders are read-only from Square (owner's
// note lives at /api/catering-orders/[orderId]/note, Firestore only).

/**
 * DELETE /api/catering-orders/[orderId]
 * Header: Authorization: Bearer <Firebase ID token>
 *
 * Hides the order from our calendar by writing to Firestore
 * `catering_hidden/{orderId}`. Square is treated as the source of
 * truth — we never mutate it from the app. The list endpoint filters
 * out any Square order whose id is in that collection.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ orderId: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  // Server-side owner gate — managers (yurina) and chefs (chuck) must
  // never be able to hide orders, even by hitting the API directly.
  if (!isStrictOwnerFromAuth(auth.email)) {
    return NextResponse.json({ error: "Owner only." }, { status: 403 });
  }
  const { orderId } = await ctx.params;
  try {
    await hideCateringOrder(orderId, auth.email);
    return NextResponse.json({ ok: true, hidden: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to hide order.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
