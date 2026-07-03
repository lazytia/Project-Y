import { NextResponse, type NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { OWNER_USERNAMES } from "@/lib/permissions";
import { emailToUsername } from "@/lib/username";
import { squareClient, squareEnv } from "@/lib/square";

/**
 * POST /api/square/create-team-member
 * Header: Authorization: Bearer <Firebase ID token of an owner>
 * Body:   {
 *           fullName: "Test User",
 *           phone?: "0450...",
 *           email?: "...",
 *           jobTitle?: "Hall Staff" | "Kitchen Staff",
 *           hourlyRateCents?: 2500
 *         }
 *
 * Creates an ACTIVE Team Member on Square, pinned to the configured
 * restaurant location, with an optional wage-setting (job title +
 * hourly rate). Returns { id } — the Square team_member id (TMxxxx).
 *
 * Square doesn't expose the 4-digit POS passcode via API — that value
 * is generated in the Square dashboard when the owner opens the new
 * team member's Access → Passcode section. The owner still has to
 * grab that 4-digit code and enter it into the app manually.
 */

function normaliseAuMobile(raw: string): string | undefined {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return undefined;
  if (digits.startsWith("61")) return "+" + digits;
  if (digits.startsWith("0")) return "+61" + digits.slice(1);
  if (digits.length === 9) return "+61" + digits;
  return "+" + digits;
}

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

  const { locationId } = squareEnv;
  if (!locationId) {
    return NextResponse.json({ error: "SQUARE_LOCATION_ID not set" }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const fullName = String(body?.fullName ?? "").trim();
  const phone = body?.phone ? normaliseAuMobile(String(body.phone)) : undefined;
  const email = body?.email ? String(body.email).trim() : undefined;
  const jobTitle = body?.jobTitle ? String(body.jobTitle).trim() : undefined;
  const hourlyRateCents =
    typeof body?.hourlyRateCents === "number" && body.hourlyRateCents > 0
      ? Math.round(body.hourlyRateCents)
      : undefined;
  if (!fullName) return NextResponse.json({ error: "fullName is required." }, { status: 400 });

  const parts = fullName.split(/\s+/);
  const givenName = parts[0];
  const familyName = parts.length > 1 ? parts.slice(1).join(" ") : undefined;

  // Attach a wage setting when we have at least a job title — this
  // populates the team member's Job & pay section in the Square
  // dashboard so the owner doesn't have to fill it in twice.
  const wageSetting = jobTitle
    ? {
        jobAssignments: [
          {
            jobTitle,
            payType: "HOURLY" as const,
            ...(hourlyRateCents
              ? {
                  hourlyRate: { amount: BigInt(hourlyRateCents), currency: "AUD" as const },
                }
              : {}),
          },
        ],
        isOvertimeExempt: false,
      }
    : undefined;

  try {
    const res = await squareClient.teamMembers.create({
      idempotencyKey: crypto.randomUUID(),
      teamMember: {
        givenName,
        familyName,
        emailAddress: email,
        phoneNumber: phone,
        status: "ACTIVE",
        assignedLocations: {
          assignmentType: "EXPLICIT_LOCATIONS",
          locationIds: [locationId],
        },
        ...(wageSetting ? { wageSetting } : {}),
      },
    });
    const page = res as unknown as {
      teamMember?: { id?: string };
      errors?: Array<{ code?: string; detail?: string }>;
    };
    if (page.errors && page.errors.length > 0) {
      const first = page.errors[0];
      return NextResponse.json(
        { error: first.detail ?? first.code ?? "Square rejected the team member." },
        { status: 502 },
      );
    }
    const id = page.teamMember?.id;
    if (!id) {
      return NextResponse.json({ error: "Square did not return a team member id." }, { status: 502 });
    }
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Square unreachable.";
    console.error("[square/create-team-member] failed:", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
