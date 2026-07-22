const CACHE_PREFIX = "y.timesheets.";
const MAX_AGE_MS = 2 * 60 * 1000;

export type TimesheetsCachePayload = {
  shifts: unknown[];
  teamMembers: Record<string, unknown>;
  savedAt: number;
};

function cacheKey(startISO: string, endISO: string): string {
  return `${CACHE_PREFIX}${startISO}_${endISO}`;
}

export function readTimesheetsCache(
  startISO: string,
  endISO: string,
): { shifts: unknown[]; teamMembers: Record<string, unknown> } | null {
  if (typeof window === "undefined" || !startISO || !endISO) return null;
  try {
    const raw = sessionStorage.getItem(cacheKey(startISO, endISO));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TimesheetsCachePayload;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) return null;
    return { shifts: parsed.shifts, teamMembers: parsed.teamMembers };
  } catch {
    return null;
  }
}

export function writeTimesheetsCache(
  startISO: string,
  endISO: string,
  shifts: unknown[],
  teamMembers: Record<string, unknown>,
) {
  if (typeof window === "undefined") return;
  try {
    const entry: TimesheetsCachePayload = {
      shifts,
      teamMembers,
      savedAt: Date.now(),
    };
    sessionStorage.setItem(cacheKey(startISO, endISO), JSON.stringify(entry));
  } catch {
    /* quota / private mode */
  }
}
