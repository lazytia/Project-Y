/**
 * Client for the system_yurica integration endpoint that exposes today's
 * booking PAX and roster staff counts to this dashboard.
 * Upstream: https://project-y.yurica.com.au
 */

const UPSTREAM_BASE =
  process.env.SYSTEM_YURICA_BASE?.trim() || "https://project-y.yurica.com.au";

export type TodayCounts = {
  date: string;
  lunchPax: number;
  dinnerPax: number;
  lunchStaff: number;
  dinnerStaff: number;
};

export async function fetchSystemYuricaTodayCounts(
  dateKey?: string,
): Promise<TodayCounts> {
  const token = process.env.SYSTEM_YURICA_TOKEN?.trim();
  if (!token) {
    const today = dateKey || new Date().toISOString().slice(0, 10);
    return { date: today, lunchPax: 0, dinnerPax: 0, lunchStaff: 0, dinnerStaff: 0 };
  }
  const url = new URL(`${UPSTREAM_BASE}/api/integrations/project-y/today`);
  if (dateKey) url.searchParams.set("date", dateKey);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Upstream ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as TodayCounts;
}
