import { NextResponse, type NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { OWNER_USERNAMES } from "@/lib/permissions";
import { emailToUsername } from "@/lib/username";
import { squareClient, squareEnv } from "@/lib/square";
import { resolveNsLocationId } from "@/lib/square-team-access";

/**
 * POST /api/square/create-team-member
 * Header: Authorization: Bearer <Firebase ID token of an owner>
 * Body:   {
 *           fullName: "Test User",
 *           givenName?: "Test",
 *           familyName?: "User",
 *           phone?: "0450...",
 *           email?: "...",
 *           jobTitle?: "Hall Staff" | "Kitchen Staff",
 *           hourlyRateCents?: 2500
 *         }
 *
 * Creates an ACTIVE Team Member on Square at Yurica Japnaese Kitchen NS,
 * with wage setting (Primary job / Hourly / training rate).
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

  const body = await req.json().catch(() => ({}));
  const fullName = String(body?.fullName ?? "").trim();
  const phoneRaw = body?.phone ? String(body.phone) : "";
  const phone = phoneRaw ? normaliseAuMobile(phoneRaw) : undefined;
  const email = body?.email ? String(body.email).trim() : undefined;
  const jobTitle = body?.jobTitle ? String(body.jobTitle).trim() : undefined;
  const hourlyRateCents =
    typeof body?.hourlyRateCents === "number" && body.hourlyRateCents > 0
      ? Math.round(body.hourlyRateCents)
      : undefined;
  if (!fullName) return NextResponse.json({ error: "fullName is required." }, { status: 400 });
  if (!phone) {
    return NextResponse.json({ error: "A valid mobile number is required." }, { status: 400 });
  }

  let locationId: string;
  try {
    locationId = await resolveNsLocationId(squareEnv.locationId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "NS location not found.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const bodyGiven = String(body?.givenName ?? "").trim();
  const bodyFamily = String(body?.familyName ?? "").trim();
  const parts = fullName.split(/\s+/);
  const givenName = bodyGiven || parts[0];
  const familyName = bodyFamily || (parts.length > 1 ? parts.slice(1).join(" ") : givenName);

  async function resolveJobId(title: string): Promise<string | null> {
    try {
      let cursor: string | undefined;
      do {
        const jobsRes = await squareClient.team.listJobs({ cursor });
        const jobsPage = jobsRes as unknown as {
          jobs?: Array<{ id?: string; title?: string }>;
          cursor?: string;
        };
        const match = (jobsPage.jobs ?? []).find(
          (j) => (j.title ?? "").trim().toLowerCase() === title.toLowerCase(),
        );
        if (match?.id) return match.id;
        cursor = jobsPage.cursor;
      } while (cursor);

      const created = await squareClient.team.createJob({
        idempotencyKey: crypto.randomUUID(),
        job: { title, isTipEligible: true },
      });
      const createdPage = created as unknown as { job?: { id?: string } };
      return createdPage.job?.id ?? null;
    } catch (err) {
      console.warn("[square/create-team-member] job resolve failed:", err);
      return null;
    }
  }

  async function applyWageSetting(teamMemberId: string): Promise<void> {
    if (!jobTitle) return;
    try {
      await squareClient.teamMembers.wageSetting.update({
        teamMemberId,
        wageSetting: {
          jobAssignments: [
            {
              jobTitle,
              payType: "HOURLY",
              ...(hourlyRateCents
                ? {
                    hourlyRate: {
                      amount: BigInt(hourlyRateCents),
                      currency: "AUD" as const,
                    },
                  }
                : {}),
            },
          ],
          isOvertimeExempt: false,
        },
      });
    } catch (err) {
      console.warn("[square/create-team-member] wage setting update failed:", err);
    }
  }

  const resolvedJobId = jobTitle ? await resolveJobId(jobTitle) : null;

  const wageSetting = resolvedJobId
    ? {
        jobAssignments: [
          {
            jobId: resolvedJobId,
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

    await applyWageSetting(id);

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Square unreachable.";
    console.error("[square/create-team-member] failed:", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
