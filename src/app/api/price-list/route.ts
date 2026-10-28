import { NextResponse, type NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { isOwnerOrChefEmail } from "@/lib/permissions";
import { fetchPriceList } from "@/lib/price-list";

/**
 * GET /api/price-list
 * Header:  Authorization: Bearer <Firebase ID token>
 *
 * Powers /operations/item-search: every supplier's items and prices, from the
 * price sheet. What a supplier charges is the kitchen's and the owners', so
 * anyone else is refused here rather than only hidden in the menu.
 *
 * Response: { suppliers: string[], items: PriceItem[] } (see lib/price-list-parse)
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const idToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!idToken) {
    return NextResponse.json({ error: "Missing bearer token." }, { status: 401 });
  }

  let email: string | null;
  try {
    email = (await adminAuth().verifyIdToken(idToken)).email ?? null;
  } catch {
    return NextResponse.json({ error: "Could not verify the sign-in." }, { status: 401 });
  }
  if (!isOwnerOrChefEmail(email)) {
    return NextResponse.json({ error: "Owners and the head chef only." }, { status: 403 });
  }

  try {
    const list = await fetchPriceList();
    return NextResponse.json(list, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (err) {
    console.error("[price-list] sheet read failed:", err);
    return NextResponse.json({ error: "Could not read the price list." }, { status: 502 });
  }
}
