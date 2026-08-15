/** Sydney date helpers shared by Money nav prefetch + owner money pages. */

const SYDNEY_TZ = "Australia/Sydney";

export function sydneyTodayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: SYDNEY_TZ });
}

export function sydneyMonthKey(): string {
  return sydneyTodayKey().slice(0, 7);
}

function isoMondayOf(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - dow);
  return dt.toISOString().slice(0, 10);
}

/** Most recently finalised pay week (the Monday before this one). */
export function isoLastCompletedPayWeek(): string {
  const thisMonday = isoMondayOf(sydneyTodayKey());
  const [y, m, d] = thisMonday.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 7);
  return dt.toISOString().slice(0, 10);
}

const PREFETCH_COOLDOWN_MS = 60_000;

let moneyPrefetchedAt = 0;
let inventoryPrefetchedAt = 0;

/** Warm the payroll API cache when the owner opens the Money nav. */
export function prefetchOwnerMoneySummaries(): void {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (now - moneyPrefetchedAt < PREFETCH_COOLDOWN_MS) return;
  moneyPrefetchedAt = now;

  const weekStart = isoLastCompletedPayWeek();
  void fetch(`/api/payroll/summary?weekStart=${weekStart}`).catch(() => {});
}

/** Suppliers sits under Inventory, so its cache warms from that group. */
export function prefetchOwnerInventorySummaries(): void {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (now - inventoryPrefetchedAt < PREFETCH_COOLDOWN_MS) return;
  inventoryPrefetchedAt = now;

  const month = sydneyMonthKey();
  void fetch(`/api/money/suppliers/summary?month=${month}`).catch(() => {});
}
