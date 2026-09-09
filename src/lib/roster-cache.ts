/** v2: staffDocs is now filtered by isTeamMember rather than by role, so a
 *  v1 entry holds a different population — the manager missing, anyone
 *  terminated still present. It parses cleanly under the same type, so
 *  without the rename a cached roster would be painted from the old rule for
 *  up to MAX_AGE_MS after the rollout. Rename this whenever what goes into
 *  staffDocs changes, not just when its shape does. */
const CACHE_KEY = "y.roster.v2";
const MAX_AGE_MS = 3 * 60 * 1000;

export type RosterCachePayload = {
  weekStartISO: string;
  staffDocs: unknown[];
  weekDoc: unknown;
  nextWeekDoc: unknown;
  prevWeekDoc: unknown;
  savedAt: number;
};

export function readRosterCache(weekStartISO: string): Omit<RosterCachePayload, "savedAt"> | null {
  if (typeof window === "undefined" || !weekStartISO) return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RosterCachePayload;
    if (parsed.weekStartISO !== weekStartISO) return null;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) return null;
    return {
      weekStartISO: parsed.weekStartISO,
      staffDocs: parsed.staffDocs,
      weekDoc: parsed.weekDoc,
      nextWeekDoc: parsed.nextWeekDoc,
      prevWeekDoc: parsed.prevWeekDoc,
    };
  } catch {
    return null;
  }
}

export function writeRosterCache(payload: Omit<RosterCachePayload, "savedAt">) {
  if (typeof window === "undefined") return;
  try {
    const entry: RosterCachePayload = { ...payload, savedAt: Date.now() };
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    /* quota / private mode */
  }
}

export function clearRosterCache() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}
