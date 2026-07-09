import { NextResponse, type NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { OWNER_USERNAMES } from "@/lib/permissions";
import { emailToUsername } from "@/lib/username";
import { squareClient } from "@/lib/square";

/**
 * POST /api/square/update-wage
 * Header: Authorization: Bearer <Firebase ID token (owner)>
 * Body: { teamMemberId: string; hourlyRateCents: number; jobTitle?: string }
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
  const jobTitle = body?.jobTitle ? String(body.jobTitle).trim() : "Staff";
  const hourlyRateCents =
    typeof body?.hourlyRateCents === "number" && body.hourlyRateCents > 0
      ? Math.round(body.hourlyRateCents)
      : 0;

  if (!teamMemberId) {
    return NextResponse.json({ error: "teamMemberId is required." }, { status: 400 });
  }
  if (!hourlyRateCents) {
    return NextResponse.json({ error: "hourlyRateCents is required." }, { status: 400 });
  }

  try {
    await squareClient.teamMembers.wageSetting.update({
      teamMemberId,
      wageSetting: {
        jobAssignments: [
          {
            jobTitle,
            payType: "HOURLY",
            hourlyRate: {
              amount: BigInt(hourlyRateCents),
              currency: "AUD" as const,
            },
          },
        ],
        isOvertimeExempt: false,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[square/update-wage] failed:", err);
    const message = err instanceof Error ? err.message : "Square wage update failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
