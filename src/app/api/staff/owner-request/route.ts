import { NextResponse, type NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { isOwnerOrChefEmail } from "@/lib/permissions";
import { pushToOwners } from "@/lib/push-notify";

/**
 * POST /api/staff/owner-request
 * Header: Authorization: Bearer <Firebase ID token>
 * Body:   { uid, staffName, kind: "cancel" | "terminate", reason?, lastWorkingDay? }
 *
 * Tells the owners that the kitchen or the floor has asked for something only
 * an owner can carry out: cancelling a hire who never started, or finishing
 * up somebody who is leaving.
 *
 * The request itself is already on the record by the time this is called (see
 * lib/staff-owner-requests) — this is the part that reaches a phone, so a
 * request raised at nine at night is not sitting unseen until somebody
 * happens to open the right screen.
 *
 * The notification deliberately says "asked", never "done". Nothing has
 * happened to the record; an owner has been asked to make it happen.
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

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  const uid = typeof body.uid === "string" ? body.uid.trim() : "";
  const staffName = typeof body.staffName === "string" ? body.staffName.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const lastWorkingDay = typeof body.lastWorkingDay === "string" ? body.lastWorkingDay.trim() : "";
  const terminate = body.kind === "terminate";
  if (!uid) {
    return NextResponse.json({ error: "uid is required." }, { status: 400 });
  }

  const asker = name?.trim() || (email ? email.split("@")[0] : "Someone");
  const who = staffName || (terminate ? "an employee" : "a new employee");
  const detail = [
    terminate && lastWorkingDay ? `last day ${lastWorkingDay}` : "",
    reason,
  ]
    .filter(Boolean)
    .join(" — ");

  try {
    const result = await pushToOwners({
      title: terminate ? "Termination requested" : "Cancellation requested",
      body: `${asker} asked to ${terminate ? "terminate" : "cancel"} ${who}${detail ? `: ${detail}` : "."}`,
      url: terminate ? `/people/active/${uid}` : `/people/onboarding/${uid}`,
    });
    return NextResponse.json({ ok: true, delivered: result.delivered });
  } catch (err) {
    console.error("[owner-request] push failed:", err);
    // The request stands on the record whether or not a phone heard about it.
    return NextResponse.json({ ok: true, delivered: 0, pushFailed: true });
  }
}
