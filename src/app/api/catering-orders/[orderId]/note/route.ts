import { NextResponse, type NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { getOwnerNote, saveOwnerNoteToFirestore } from "@/lib/catering-firestore";

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

/**
 * GET /api/catering-orders/[orderId]/note
 * Returns the owner's note from Firestore (not Square).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ orderId: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { orderId } = await ctx.params;
  const ownerNote = await getOwnerNote(orderId);
  return NextResponse.json({ ownerNote });
}

/**
 * PUT /api/catering-orders/[orderId]/note
 * Saves the owner's note to Firestore only — never touches Square.
 */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ orderId: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { orderId } = await ctx.params;
  let body: { ownerNote?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const note = typeof body.ownerNote === "string" ? body.ownerNote : "";
  try {
    await saveOwnerNoteToFirestore(orderId, note);
    return NextResponse.json({ ok: true, ownerNote: note });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to save note.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
