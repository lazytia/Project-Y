import { NextRequest, NextResponse } from "next/server";
import { computeWeekPair } from "@/lib/square-weekly-daily";
import {
  fetchOrders,
  getSalesDayRange,
  isLunchInstant,
  localHourIn,
  shiftDateKey,
  squareEnv,
  squareGrossSalesCents,
  SALES_DAY_START_HOUR,
  SALES_DAY_END_HOUR,
} from "@/lib/square";

/**
 * GET /api/square/weekly-service?weekStart=YYYY-MM-DD
 *
 * Splits each day of the given week — and the week before it — into lunch and
 * dinner Gross Sales, plus the online-ordering slice. Powers the "This Week
 * Performance" card on /money/sales.
 *
 * The dollar amounts come from the same Reporting API figures that draw the
 * weekly chart, so lunch + dinner always adds back up to the bar above it.
 * Orders are only used to work out each day's *share*: Reporting has no
 * service or channel breakdown, and reconciling two different bases would
 * leave the card contradicting the chart it sits under.
 *
 * `online` is cut from the same money by channel rather than by clock, so it
 * overlaps lunch and dinner instead of extending them — it is a "how much of
 * the day arrived through the website" figure, not a fourth bucket.
 *
 * Refunds are deliberately left out of the share calculation — they are
 * already netted off the Reporting totals being apportioned, and at ratio
 * level the correction is noise.
 */

export const dynamic = "force-dynamic";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Past weeks are settled; the running week carries live tickets. */
const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=1800",
} as const;
const LIVE_HEADERS = { "Cache-Control": "no-store" } as const;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Square stamps web-store tickets with this source; the POS uses "Point of Sale". */
const ONLINE_SOURCE_NAME = "Square Online";

type ServiceWeek = { lunch: number[]; dinner: number[]; online: number[] };
/** Per-day fractions (0–1) of each day's takings, measured from orders. */
type WeekShares = { lunch: number[]; online: number[] };

function todaySydneyKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
}

function localDateKeyIn(instant: string, timezone: string): string {
  return new Date(instant).toLocaleDateString("en-CA", { timeZone: timezone });
}

/**
 * Lunch and online shares (0–1) for each of the 7 days starting at
 * `mondayKey`, measured from line-item gross sales inside the 9am–10pm
 * window. Both come off the one order sweep. Days with no takings fall back
 * to 0 — their Reporting total is zero anyway, so the share is moot.
 */
async function sharesForWeek(
  locationId: string,
  timezone: string,
  mondayKey: string,
): Promise<WeekShares> {
  const sundayKey = shiftDateKey(mondayKey, 6, timezone);
  const startAt = getSalesDayRange(timezone, mondayKey).startAt;
  const endAt = getSalesDayRange(timezone, sundayKey).endAt;

  // One fetch for the whole week, then bucketed in memory — a per-day fetch
  // would be 7 round-trips for the same rows.
  const orders = await fetchOrders(locationId, startAt, endAt, ["OPEN", "COMPLETED"]);

  const lunchCents = new Array(7).fill(0);
  const onlineCents = new Array(7).fill(0);
  const totalCents = new Array(7).fill(0);
  for (const order of orders) {
    if (!order.createdAt) continue;
    const hour = localHourIn(order.createdAt, timezone);
    if (hour < SALES_DAY_START_HOUR || hour >= SALES_DAY_END_HOUR) continue;
    const dayKey = localDateKeyIn(order.createdAt, timezone);
    const idx = Math.round(
      (Date.parse(`${dayKey}T00:00:00Z`) - Date.parse(`${mondayKey}T00:00:00Z`)) / 86_400_000,
    );
    if (idx < 0 || idx > 6) continue;
    const cents = squareGrossSalesCents(order);
    totalCents[idx] += cents;
    if (isLunchInstant(order.createdAt, timezone)) lunchCents[idx] += cents;
    if (order.source?.name === ONLINE_SOURCE_NAME) onlineCents[idx] += cents;
  }

  const shareOf = (part: number[]) =>
    totalCents.map((t, i) => (t > 0 ? part[i] / t : 0));
  return { lunch: shareOf(lunchCents), online: shareOf(onlineCents) };
}

/** Apportion each day's Reporting gross total across the card's rows. */
function applyShares(daily: number[], shares: WeekShares): ServiceWeek {
  const lunch = daily.map((total, i) => round2(total * (shares.lunch[i] ?? 0)));
  const dinner = daily.map((total, i) => round2(total - lunch[i]));
  const online = daily.map((total, i) => round2(total * (shares.online[i] ?? 0)));
  return { lunch, dinner, online };
}

export async function GET(req: NextRequest) {
  const { locationId, timezone, accessToken } = squareEnv;
  if (!locationId || !accessToken) {
    return NextResponse.json({ error: "Square not configured" }, { status: 500 });
  }

  const weekStart = req.nextUrl.searchParams.get("weekStart");
  if (!weekStart || !DATE_KEY_RE.test(weekStart)) {
    return NextResponse.json({ error: "weekStart=YYYY-MM-DD required" }, { status: 400 });
  }

  const prevWeekStart = shiftDateKey(weekStart, -7, timezone);
  const isPastWeek = shiftDateKey(weekStart, 6, timezone) < todaySydneyKey();

  try {
    const [pair, thisShares, lastShares] = await Promise.all([
      computeWeekPair(locationId, timezone, weekStart),
      sharesForWeek(locationId, timezone, weekStart),
      sharesForWeek(locationId, timezone, prevWeekStart),
    ]);

    return NextResponse.json(
      {
        weekStart,
        thisWeek: applyShares(pair.thisWeek.daily, thisShares),
        lastWeek: applyShares(pair.lastWeek.daily, lastShares),
      },
      { headers: isPastWeek ? CACHE_HEADERS : LIVE_HEADERS },
    );
  } catch (err) {
    console.error("[Square] weekly-service error:", err);
    return NextResponse.json({ error: "Failed to fetch Square data" }, { status: 502 });
  }
}
