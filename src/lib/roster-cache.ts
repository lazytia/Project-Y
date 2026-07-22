const CACHE_KEY = "y.roster";
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
