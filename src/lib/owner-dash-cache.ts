/**
 * Owner dashboard snapshot cache — localStorage-backed so returning
 * visits (including PWA cold starts) paint immediately.
 */

export type DashCache = Partial<{
  todaySales: number;
  restaurantSales: number;
  platterSales: number;
  weeklyProgress: number;
  bestSellers: { name: string; sales: number; quantity: number }[];
  savedDaySales: number;
  lunchPax: number;
  dinnerPax: number;
  lunchStaff: number;
  dinnerStaff: number;
  prevWeekSales: number;
  weekSalesDoc: number;
  weeklyPayroll: number;
  reviewNote: string;
  nextCateringISO: string;
  weekCateringCount: number;
  cachedAt: number;
}>;

const CACHE_PREFIX = "y.ownerDash.v2";
const LEGACY_SESSION_PREFIX = "y.ownerDash.";

let migrated = false;

function ensureMigrated() {
  if (migrated || typeof window === "undefined") return;
  migrated = true;
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (!key?.startsWith(LEGACY_SESSION_PREFIX)) continue;
      const dateKey = key.slice(LEGACY_SESSION_PREFIX.length);
      const val = sessionStorage.getItem(key);
      if (val && !localStorage.getItem(cacheKey(dateKey))) {
        localStorage.setItem(cacheKey(dateKey), val);
      }
      sessionStorage.removeItem(key);
    }
  } catch {
    /* quota / private mode */
  }
}

function cacheKey(dateKey: string) {
  return `${CACHE_PREFIX}.${dateKey}`;
}

export function readDashCache(dateKey: string): DashCache | null {
  if (typeof window === "undefined" || !dateKey) return null;
  ensureMigrated();
  try {
    const raw = localStorage.getItem(cacheKey(dateKey));
    return raw ? (JSON.parse(raw) as DashCache) : null;
  } catch {
    return null;
  }
}

export function hasDashCache(dateKey: string): boolean {
  const cached = readDashCache(dateKey);
  if (!cached) return false;
  return (
    typeof cached.todaySales === "number" ||
    typeof cached.savedDaySales === "number" ||
    typeof cached.weeklyProgress === "number" ||
    typeof cached.weekSalesDoc === "number"
  );
}

export function writeDashCache(dateKey: string, patch: DashCache) {
  if (typeof window === "undefined" || !dateKey) return;
  ensureMigrated();
  try {
    const prev = readDashCache(dateKey) ?? {};
    localStorage.setItem(
      cacheKey(dateKey),
      JSON.stringify({ ...prev, ...patch, cachedAt: Date.now() }),
    );
  } catch {
    /* quota / private mode */
  }
}
