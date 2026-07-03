import { NextResponse, type NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { OWNER_USERNAMES } from "@/lib/permissions";
import { emailToUsername } from "@/lib/username";
import { squareClient, squareEnv } from "@/lib/square";

/** Always assign new hires to this Square location (Access → Locations). */
const NS_LOCATION_NAME = "Yurica Japnaese Kitchen NS";

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
 * with wage setting (Primary job / Hourly / training rate). Returns
 * { id, passcode, permissionSetName } — passcode is a generated 4-digit
 * Staff ID pre-filled into Create Login Details; use the same code in
 * Square → Access → Passcode (Square has no API for permission sets).
 */

function normaliseAuMobile(raw: string): string | undefined {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return undefined;
  if (digits.startsWith("61")) return "+" + digits;
  if (digits.startsWith("0")) return "+61" + digits.slice(1);
  if (digits.length === 9) return "+61" + digits;
  return "+" + digits;
}

function permissionSetNameForJob(jobTitle?: string): string | undefined {
  if (!jobTitle) return undefined;
  const p = jobTitle.trim().toLowerCase();
  if (p.includes("kitchen")) return "Kitchen Staff";
  if (p.includes("hall")) return "Hall Staff";
  return jobTitle.trim();
}

async function resolveNsLocationId(fallback?: string): Promise<string> {
  try {
    const res = await squareClient.locations.list();
    const match = (res.locations ?? []).find((l) => (l.name ?? "").trim() === NS_LOCATION_NAME);
    if (match?.id) return match.id;
  } catch (err) {
    console.warn("[square/create-team-member] location lookup failed:", err);
  }
  if (fallback) return fallback;
  throw new Error(`Square location "${NS_LOCATION_NAME}" not found.`);
}

async function generateUniquePasscode(): Promise<string> {
  const used = new Set<string>();
  try {
    let cursor: string | undefined;
    do {
      const res = await squareClient.teamMembers.search({
        query: { filter: { status: "ACTIVE" } },
        cursor,
        limit: 200,
      });
      const page = res as unknown as {
        teamMembers?: Array<{ referenceId?: string | null }>;
        cursor?: string;
      };
      for (const tm of page.teamMembers ?? []) {
        const ref = (tm.referenceId ?? "").trim();
        if (/^\d{4}$/.test(ref)) used.add(ref);
      }
      cursor = page.cursor;
    } while (cursor);
  } catch (err) {
    console.warn("[square/create-team-member] passcode scan failed:", err);
  }

  for (let i = 0; i < 100; i++) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    if (!used.has(code)) return code;
  }
  return String(Math.floor(1000 + Math.random() * 9000));
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
  const phone = body?.phone ? normaliseAuMobile(String(body.phone)) : undefined;
  const email = body?.email ? String(body.email).trim() : undefined;
  const jobTitle = body?.jobTitle ? String(body.jobTitle).trim() : undefined;
  const hourlyRateCents =
    typeof body?.hourlyRateCents === "number" && body.hourlyRateCents > 0
      ? Math.round(body.hourlyRateCents)
      : undefined;
  if (!fullName) return NextResponse.json({ error: "fullName is required." }, { status: 400 });

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
  // Square rejects an empty family_name — fall back to the given name
  // when the request only carries a single word. Owner can tidy up in
  // the Square dashboard.
  const familyName = bodyFamily || (parts.length > 1 ? parts.slice(1).join(" ") : givenName);
  const permissionSetName = permissionSetNameForJob(jobTitle);
  const passcode = await generateUniquePasscode();

  // CreateTeamMember wage_setting requires job_id — resolve via Team Jobs API
  // (not Labor). wageSetting.update accepts jobTitle directly, so we always
  // call that after create to pre-fill Primary job / Hourly / training rate.
  async function resolveJobId(title: string): Promise<string | null> {
    try {
      let cursor: string | undefined;
      do {
        const jobsRes = await squareClient.team.listJobs({ cursor, limit: 200 });
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
        referenceId: passcode,
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

    return NextResponse.json({
      ok: true,
      id,
      passcode,
      permissionSetName,
      locationName: NS_LOCATION_NAME,
      squareAccessUrl: `https://squareup.com/dashboard/team/team-members/${id}/access`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Square unreachable.";
    console.error("[square/create-team-member] failed:", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
