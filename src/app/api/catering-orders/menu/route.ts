import { NextResponse, type NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { squareClient, squareEnv } from "@/lib/square";

/**
 * GET /api/catering-orders/menu
 * Header: Authorization: Bearer <Firebase ID token>
 *
 * Returns the Platter location's catalog ITEMs in a flat shape ready
 * for the Add Item bottom-sheet on the new-catering-order form.
 *   { items: [{ id, name, priceCents, currency }] }
 */
type CatalogObject = {
  id?: string;
  type?: string;
  presentAtAllLocations?: boolean;
  presentAtLocationIds?: string[];
  absentAtLocationIds?: string[];
  itemData?: {
    name?: string;
    variations?: Array<{
      id?: string;
      itemVariationData?: {
        priceMoney?: { amount?: number | bigint; currency?: string };
      };
    }>;
  };
};

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

function isAtPlatter(obj: CatalogObject, platterId: string): boolean {
  if (obj.presentAtAllLocations) {
    return !(obj.absentAtLocationIds ?? []).includes(platterId);
  }
  return (obj.presentAtLocationIds ?? []).includes(platterId);
}

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const platterId = squareEnv.platterLocationId;
  if (!platterId) return NextResponse.json({ error: "SQUARE_PLATTER_LOCATION_ID not set." }, { status: 500 });
  try {
    // Square's Platter catalog contains a handful of duplicated ITEMs
    // (same name, separate IDs, different prices — likely accidental
    // dupes from manual data entry). Collapse by case-insensitive name
    // and keep the higher-priced variant (the up-to-date one the owners
    // use) so the Add Item sheet only shows one row per dish.
    const byName = new Map<string, { id: string; name: string; priceCents: number; currency: string }>();
    const page = await squareClient.catalog.list({ types: "ITEM" });
    for await (const obj of page) {
      const o = obj as CatalogObject;
      if (o.type !== "ITEM") continue;
      if (!isAtPlatter(o, platterId)) continue;
      const name = o.itemData?.name;
      if (!name || !o.id) continue;
      const v = o.itemData?.variations?.[0];
      const amt = v?.itemVariationData?.priceMoney?.amount;
      const cents = typeof amt === "bigint" ? Number(amt) : (amt ?? 0);
      const candidate = {
        id: o.id,
        name,
        priceCents: cents,
        currency: v?.itemVariationData?.priceMoney?.currency ?? "AUD",
      };
      const key = name.trim().toLowerCase();
      const existing = byName.get(key);
      if (!existing || candidate.priceCents > existing.priceCents) {
        byName.set(key, candidate);
      }
    }
    const items = Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json(
      { items },
      // Square catalog rarely changes within a session; cache briefly so
      // re-opening the Add Item sheet doesn't hit Square again.
      { headers: { "cache-control": "private, max-age=300" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load Square menu.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
