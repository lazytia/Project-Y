import { squareClient, squareEnv } from "@/lib/square";

/** Always assign new hires to this Square location. */
export const NS_LOCATION_NAME = "Yurica Japnaese Kitchen NS";

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
