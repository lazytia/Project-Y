import { NextResponse, type NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { OWNER_USERNAMES } from "@/lib/permissions";
import { emailToUsername } from "@/lib/username";
import { setCategoryPresence } from "@/lib/sold-out-square";

/**
 * POST /api/menu/set-sold-out
 * Body: { categoryId: "squid" | "snapper" | "trevally" | "tuna",
 *         soldOut: boolean }
 *
 * Owner-only — verified via the Firebase ID token in
 * Authorization: Bearer <idToken>. Flips every Square catalog item
 * in the category by setting presentAtAllLocations.
 */
async function verifyOwner(req: NextRequest): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const idToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!idToken) return { ok: false, status: 401, error: "Missing bearer token." };
  try {
    const decoded = await adminAuth().verifyIdToken(idToken);
    const username = emailToUsername(decoded.email ?? "").toLowerCase();
    if (!OWNER_USERNAMES.has(username)) {
      return { ok: false, status: 403, error: "Forbidden — owner only." };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      status: 401,
      error: `Token verification failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function POST(req: NextRequest) {
  const auth = await verifyOwner(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { categoryId?: string; soldOut?: boolean };
  try {
    body = (await req.json()) as { categoryId?: string; soldOut?: boolean };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const { categoryId, soldOut } = body;
  if (!categoryId || typeof soldOut !== "boolean") {
    return NextResponse.json(
      { error: "Body must be { categoryId: string, soldOut: boolean }." },
      { status: 400 },
    );
  }

  try {
    const updated = await setCategoryPresence(categoryId, !soldOut);
    return NextResponse.json({ ok: true, categoryId, soldOut, itemsUpdated: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to update Square.";
    const detail =
      err && typeof err === "object"
        ? JSON.stringify(
            { ...(err as Record<string, unknown>), message: msg },
            (_k, v) => (typeof v === "bigint" ? v.toString() : v),
          )
        : msg;
    console.error("[set-sold-out] Square upsert failed:", detail);
    return NextResponse.json({ error: msg, detail }, { status: 500 });
  }
}
