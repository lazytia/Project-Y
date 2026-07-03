import { NextResponse, type NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { OWNER_USERNAMES } from "@/lib/permissions";
import { emailToUsername } from "@/lib/username";
import { squareEnv } from "@/lib/square";
import {
  passcodeFromMobile,
  permissionSetNameForJob,
  provisionTeamAccess,
  resolveNsLocationId,
} from "@/lib/square-team-access";

/**
 * POST /api/square/provision-team-access
 * Header: Authorization: Bearer <Firebase ID token of an owner>
 * Body:   {
 *           teamMemberId: "TMxxxx",
 *           phone: "0450...",
 *           jobTitle?: "Hall Staff"
 *         }
 *
 * Reinforces NS location + mobile-last-4 referenceId on the team member.
 * Returns Access field values for Square Dashboard (permission set, location,
 * passcode) — Connect API cannot write those Access fields directly.
 */

async function verifyOwner(
  req: NextRequest,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const idToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!idToken) return { ok: false, status: 401, error: "Missing bearer token." };
  try {
    const decoded = await adminAuth().verifyIdToken(idToken);
    const username = emailToUsername(decoded.email ?? "").toLowerCase();
    if (!OWNER_USERNAMES.has(username)) {
      return { ok: false, status: 403, error: "Owner only." };
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

  const body = await req.json().catch(() => ({}));
  const teamMemberId = String(body?.teamMemberId ?? "").trim();
  const phoneRaw = String(body?.phone ?? "");
  const jobTitle = body?.jobTitle ? String(body.jobTitle).trim() : undefined;

  if (!teamMemberId) {
    return NextResponse.json({ error: "teamMemberId is required." }, { status: 400 });
  }

  const passcode = passcodeFromMobile(phoneRaw);
  if (!passcode) {
    return NextResponse.json(
      { error: "Mobile number must have at least 4 digits for passcode." },
      { status: 400 },
    );
  }

  let locationId: string;
  try {
    locationId = await resolveNsLocationId(squareEnv.locationId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "NS location not found.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const permissionSetName = permissionSetNameForJob(jobTitle);
  const result = await provisionTeamAccess({
    teamMemberId,
    permissionSetName,
    passcode,
    locationId,
  });

  return NextResponse.json({ ok: true, ...result });
}
