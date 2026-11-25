import { NextResponse, type NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { isOwnerOrChefEmail } from "@/lib/permissions";
import { pushToOwners } from "@/lib/push-notify";

/**
 * POST /api/staff/cancel-request
 * Header: Authorization: Bearer <Firebase ID token>
 * Body:   { uid: string, staffName: string, reason?: string }
 *
 * Tells the owners that the kitchen or the floor has asked for a new hire's
 * record to be cancelled. The request itself is already on the record by the
 * time this is called (see lib/staff-cancel-request) — this is the part that
 * reaches a phone, so that a request raised at nine at night is not sitting
 * unseen until somebody happens to open New Employees.
 *
 * The notification deliberately does not say "deleted". Nothing has been
 * deleted; an owner has been asked to.
 */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const idToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!idToken) {
    return NextResponse.json({ error: "Missing bearer token." }, { status: 401 });
  }

  let email: string | null;
  let name: string | null;
  try {
    const decoded = await adminAuth().verifyIdToken(idToken);
    email = decoded.email ?? null;
    name = (decoded.name as string | undefined) ?? null;
  } catch {
    return NextResponse.json({ error: "Could not verify the sign-in." }, { status: 401 });
  }
  if (!isOwnerOrChefEmail(email)) {
    return NextResponse.json({ error: "Owners and the head chef only." }, { status: 403 });
  }

  let body: { uid?: unknown; staffName?: unknown; reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  const uid = typeof body.uid === "string" ? body.uid.trim() : "";
  const staffName = typeof body.staffName === "string" ? body.staffName.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!uid) {
    return NextResponse.json({ error: "uid is required." }, { status: 400 });
  }

  const asker = name?.trim() || (email ? email.split("@")[0] : "Someone");
  const who = staffName || "A new employee";
  try {
    const result = await pushToOwners({
      title: "Cancellation requested",
      body: reason
        ? `${asker} asked to cancel ${who}: ${reason}`
        : `${asker} asked to cancel ${who}.`,
      url: `/people/onboarding/${uid}`,
    });
    return NextResponse.json({ ok: true, delivered: result.delivered });
  } catch (err) {
    console.error("[cancel-request] push failed:", err);
    // The request stands on the record whether or not a phone heard about it.
    return NextResponse.json({ ok: true, delivered: 0, pushFailed: true });
  }
}
