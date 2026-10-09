import { NextResponse, type NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { saveDetailsOverride } from "@/lib/catering-firestore";
import { parseDetailsPatch } from "@/lib/catering-details";
import { isStrictOwnerEmail } from "@/lib/permissions";

/**
 * Owner-only order details for a catering job — name, company, phone, email,
 * pickup or delivery, delivery address, utensils and the ready-by time.
 *
 * Square stays the source of truth and is never mutated: what is entered here
 * lives in Firestore (`catering_details/{squareOrderId}`) and is overlaid on
 * the Square order by the list, summary and detail GET endpoints.
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

/**
 * PUT /api/catering-orders/[orderId]/details
 * Body: any of { clientName, companyName, contactPhone, contactEmail,
 *   fulfillmentType, deliveryAddress, utensilsCount, readyByTime (24h "HH:MM") }.
 * A field that is null or empty is removed from the override. Owner only.
 * Writes Firestore only — Square is never touched.
 */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ orderId: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  // Server-side gate as well as the hidden button: managers and chefs must not
  // be able to edit an order by calling the API directly.
  if (!isStrictOwnerEmail(auth.email)) {
    return NextResponse.json({ error: "Owner only." }, { status: 403 });
  }
  const { orderId } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = parseDetailsPatch(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const details = await saveDetailsOverride(orderId, parsed.patch, auth.email);
    return NextResponse.json({ ok: true, details: details ?? {} });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to save details.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
