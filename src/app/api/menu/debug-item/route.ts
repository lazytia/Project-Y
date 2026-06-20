import { NextResponse, type NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { OWNER_USERNAMES } from "@/lib/permissions";
import { emailToUsername } from "@/lib/username";
import { squareClient } from "@/lib/square";

/**
 * GET /api/menu/debug-item?itemId=HWPC5OPZO7IIAHU2CT7GAK2F
 * Owner-only. Returns the raw Square catalog ITEM (and its variations)
 * so we can confirm whether sold-out upserts actually flipped the
 * presence fields Square stores.
 */
async function verifyOwner(req: NextRequest) {
  const idToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!idToken) return { ok: false as const, status: 401, error: "Missing bearer token." };
  try {
    const decoded = await adminAuth().verifyIdToken(idToken);
    const username = emailToUsername(decoded.email ?? "").toLowerCase();
    if (!OWNER_USERNAMES.has(username)) {
      return { ok: false as const, status: 403, error: "Forbidden — owner only." };
    }
    return { ok: true as const };
  } catch (err) {
    return {
      ok: false as const,
      status: 401,
      error: `Token verification failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function GET(req: NextRequest) {
  const auth = await verifyOwner(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const url = new URL(req.url);
  const itemId = url.searchParams.get("itemId");
  if (!itemId) return NextResponse.json({ error: "Pass ?itemId=..." }, { status: 400 });
  try {
    const obj = await squareClient.catalog.object.get({ objectId: itemId, includeRelatedObjects: true });
    const json = JSON.parse(
      JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
    );
    return NextResponse.json({ ok: true, item: json });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Square fetch failed.";
    const detail =
      err && typeof err === "object"
        ? JSON.stringify(err, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
        : msg;
    return NextResponse.json({ error: msg, detail }, { status: 500 });
  }
}
