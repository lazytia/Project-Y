import { squareClient, squareEnv } from "@/lib/square";

/** Always assign new hires to this Square location (Access → Locations). */
export const NS_LOCATION_NAME = "Yurica Japnaese Kitchen NS";

export function permissionSetNameForJob(jobTitle?: string): string | undefined {
  if (!jobTitle) return undefined;
  const p = jobTitle.trim().toLowerCase();
  if (p.includes("kitchen")) return "Kitchen Staff";
  if (p.includes("hall")) return "Hall Staff";
  return jobTitle.trim();
}

/** Last 4 digits of the mobile number — Square Staff ID / POS passcode. */
export function passcodeFromMobile(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 4) return null;
  return digits.slice(-4);
}

export async function resolveNsLocationId(fallback?: string): Promise<string> {
  try {
    const res = await squareClient.locations.list();
    const match = (res.locations ?? []).find((l) => (l.name ?? "").trim() === NS_LOCATION_NAME);
    if (match?.id) return match.id;
  } catch (err) {
    console.warn("[square-team-access] location lookup failed:", err);
  }
  if (fallback) return fallback;
  throw new Error(`Square location "${NS_LOCATION_NAME}" not found.`);
}

export type TeamAccessProvisionInput = {
  teamMemberId: string;
  permissionSetName?: string;
  passcode: string;
  locationId: string;
};

export type TeamAccessProvisionResult = {
  /** Square Connect API cannot set permission set / Access passcode — manual step still required. */
  squareAccessManualRequired: true;
  passcode: string;
  permissionSetName?: string;
  locationName: string;
  squareAccessUrl: string;
  referenceIdUpdated: boolean;
  locationUpdated: boolean;
};

/**
 * Best-effort Access provisioning after CreateTeamMember.
 * Square does not expose permission-set or passcode fields on Connect API —
 * we reinforce referenceId (Staff ID) + NS location, then return values for
 * the owner to enter on the Access screen (permission set + passcode).
 */
export async function provisionTeamAccess(
  input: TeamAccessProvisionInput,
): Promise<TeamAccessProvisionResult> {
  const { teamMemberId, permissionSetName, passcode, locationId } = input;
  let referenceIdUpdated = false;
  let locationUpdated = false;

  try {
    await squareClient.teamMembers.update({
      teamMemberId,
      body: {
        teamMember: {
          referenceId: passcode,
          assignedLocations: {
            assignmentType: "EXPLICIT_LOCATIONS",
            locationIds: [locationId],
          },
        },
      },
    });
    referenceIdUpdated = true;
    locationUpdated = true;
  } catch (err) {
    console.warn("[square-team-access] team member update failed:", err);
  }

  // Undocumented endpoints — safe no-ops when unavailable.
  const token = squareEnv.accessToken ?? "";
  if (token) {
    const base = squareEnv.isProd
      ? "https://connect.squareup.com"
      : "https://connect.squareupsandbox.com";
    const attempts = [
      {
        path: `/v2/team-members/${teamMemberId}/permission-set-assignment`,
        body: {
          permission_set_name: permissionSetName,
          location_ids: [locationId],
          passcode,
        },
      },
      {
        path: `/v2/team-members/${teamMemberId}/access-settings`,
        body: {
          permission_set_name: permissionSetName,
          location_ids: [locationId],
          passcode,
        },
      },
    ];
    for (const { path, body } of attempts) {
      try {
        await fetch(base + path, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Square-Version": "2026-05-20",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
      } catch {
        /* ignore */
      }
    }
  }

  return {
    squareAccessManualRequired: true,
    passcode,
    permissionSetName,
    locationName: NS_LOCATION_NAME,
    squareAccessUrl: `https://squareup.com/dashboard/team/team-members/${teamMemberId}/access`,
    referenceIdUpdated,
    locationUpdated,
  };
}
