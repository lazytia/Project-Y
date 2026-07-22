export type ManagerDashCache = {
  date: string;
  todaySales: number | null;
  totalPax: number | null;
  totalBookings: number | null;
  nextCatering: { deliveryDateISO: string } | null;
  weekCateringCount: number | null;
  kitchenStaff: number | null;
  hallStaff: number | null;
  cachedAt?: number;
};

const CACHE_PREFIX = "y.managerDash.v2";
const LEGACY_KEY = "y.managerDash";

let migrated = false;

function ensureMigrated() {
  if (migrated || typeof window === "undefined") return;
  migrated = true;
  try {
    const legacy = sessionStorage.getItem(LEGACY_KEY);
    if (legacy && !localStorage.getItem(`${CACHE_PREFIX}.legacy`)) {
      localStorage.setItem(`${CACHE_PREFIX}.legacy`, legacy);
      sessionStorage.removeItem(LEGACY_KEY);
    }
  } catch {
    /* ignore */
  }
}

function cacheKey(date: string) {
  return `${CACHE_PREFIX}.${date}`;
}

export function readManagerDashCache(date: string): ManagerDashCache | null {
  if (typeof window === "undefined" || !date) return null;
  ensureMigrated();
  try {
    const raw =
      localStorage.getItem(cacheKey(date)) ??
      localStorage.getItem(`${CACHE_PREFIX}.legacy`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ManagerDashCache;
    return parsed.date === date ? parsed : null;
  } catch {
    return null;
  }
}

export function hasManagerDashCache(date: string): boolean {
  const cached = readManagerDashCache(date);
  if (!cached) return false;
  return (
    typeof cached.todaySales === "number" ||
    typeof cached.totalPax === "number" ||
    typeof cached.kitchenStaff === "number"
  );
}

export function writeManagerDashCache(data: ManagerDashCache) {
  if (typeof window === "undefined" || !data.date) return;
  ensureMigrated();
  try {
    localStorage.setItem(
      cacheKey(data.date),
      JSON.stringify({ ...data, cachedAt: Date.now() }),
    );
  } catch {
    /* quota / private mode */
  }
}
