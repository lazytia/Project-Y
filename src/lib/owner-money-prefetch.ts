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

/** Most recently finalised pay week (two Mondays back from today). */
export function isoLastCompletedPayWeek(): string {
  const thisMonday = isoMondayOf(sydneyTodayKey());
  const [y, m, d] = thisMonday.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 14);
  return dt.toISOString().slice(0, 10);
}

let prefetchedAt = 0;
const PREFETCH_COOLDOWN_MS = 60_000;

/** Warm payroll + suppliers API caches when the owner opens the Money nav. */
export function prefetchOwnerMoneySummaries(): void {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (now - prefetchedAt < PREFETCH_COOLDOWN_MS) return;
  prefetchedAt = now;

  const month = sydneyMonthKey();
  const weekStart = isoLastCompletedPayWeek();
  void fetch(`/api/money/suppliers/summary?month=${month}`).catch(() => {});
  void fetch(`/api/payroll/summary?weekStart=${weekStart}`).catch(() => {});
}
