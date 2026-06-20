import { NextResponse, type NextRequest } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import {
  fetchOrders,
  getSalesDayRange,
  shiftDateKey,
  squareEnv,
  squareGrossSalesCents,
  sumRefundCents,
} from "@/lib/square";

/* ──────────────────────────────────────────────────────────────────────
 * POST /api/square/sync?weeks=4
 * Header: Authorization: Bearer <SQUARE_SYNC_SHARED_TOKEN>
 *
 * Walks the last N weeks (default 4) Monday → Sunday and aggregates
 * Square Web "Gross Sales" (line items' grossSalesMoney − refunds),
 * matching the Sales Summary figure shown in the Square dashboard.
 * Result is written to `sales_weekly/{Monday-ISO}`.
 *
 * Schedule with Cloud Scheduler — daily during business hours so the
 * current week's running total keeps updating, or once a week on
 * Sunday night to lock the previous week in.
 * ──────────────────────────────────────────────────────────────────── */

const ORDER_STATES = ["OPEN", "COMPLETED"];

function isoMondayFromDateKey(dateKey: string, timezone: string): string {
  // dateKey YYYY-MM-DD → Monday of that week (Mon = 0)
  const noonUtc = new Date(dateKey + "T12:00:00Z");
  const dow = new Date(
    noonUtc.toLocaleString("en-US", { timeZone: timezone }),
  ).getDay();
  const daysSinceMon = (dow + 6) % 7;
  return shiftDateKey(dateKey, -daysSinceMon, timezone);
}

export async function POST(req: NextRequest) {
  const want = process.env.SQUARE_SYNC_SHARED_TOKEN ?? "";
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!want || got !== want) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const weeks = Math.max(1, Math.min(12, parseInt(url.searchParams.get("weeks") ?? "4", 10) || 4));
  const locationId = squareEnv.locationId;
  if (!locationId) {
    return NextResponse.json({ error: "SQUARE_LOCATION_ID not set" }, { status: 500 });
  }
  const tz = squareEnv.timezone;

  // Anchor on today's date in the configured timezone.
  const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: tz });
  const todayMon = isoMondayFromDateKey(todayKey, tz);

  const synced: Array<{ weekStartISO: string; grossSales: number; days: number }> = [];

  for (let w = 0; w < weeks; w += 1) {
    // Walk Mondays backwards from this week.
    // shiftDateKey gives a calendar date; we want each week's Monday.
    const mondayKey = shiftDateKey(todayMon, -7 * w, tz);

    let weekGrossCents = 0;
    let daysIncluded = 0;
    for (let i = 0; i < 7; i += 1) {
      const dayKey = shiftDateKey(mondayKey, i, tz);
      // Skip future days for the current in-progress week.
      if (dayKey > todayKey) continue;
      const { startAt, endAt } = getSalesDayRange(tz, dayKey);
      const orders = await fetchOrders(locationId, startAt, endAt, ORDER_STATES);
      let dayGross = 0;
      for (const o of orders) dayGross += squareGrossSalesCents(o);
      const refunds = await sumRefundCents(locationId, startAt, endAt);
      weekGrossCents += dayGross - refunds;
      daysIncluded += 1;
    }

    await adminDb()
      .collection("sales_weekly")
      .doc(mondayKey)
      .set(
        {
          weekStartISO: mondayKey,
          grossSales: Math.round(weekGrossCents) / 100,
          currency: "AUD",
          source: "square",
          daysIncluded,
          syncedAt: Timestamp.now(),
        },
        { merge: true },
      );
    synced.push({ weekStartISO: mondayKey, grossSales: Math.round(weekGrossCents) / 100, days: daysIncluded });
  }

  return NextResponse.json({ ok: true, weeks: synced.length, synced });
}
