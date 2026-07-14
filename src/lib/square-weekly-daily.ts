import { adminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import {
  fetchOrders,
  getSalesDayRange,
  shiftDateKey,
  squareClient,
  squareEnv,
  squareGrossSalesCents,
} from "@/lib/square";

const ORDER_STATES = ["OPEN", "COMPLETED"];

type Refund = {
  createdAt?: string;
  amountMoney?: { amount?: bigint };
};

async function fetchRefunds(
  locationId: string,
  startAt: string,
  endAt: string,
): Promise<Refund[]> {
  const refunds: Refund[] = [];
  const iter = await squareClient.refunds.list({
    locationId,
    beginTime: startAt,
    endTime: endAt,
    limit: 100,
    sortField: "CREATED_AT",
  });
  for await (const r of iter) refunds.push(r as Refund);
  return refunds;
}

function localDateKey(iso: string, timezone: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-CA", { timeZone: timezone });
}

export async function computeWeekPair(
  locationId: string,
  timezone: string,
  weekStart: string,
): Promise<{
  thisWeek: { daily: number[]; total: number };
  lastWeek: { daily: number[]; total: number };
}> {
  const prevWeekStart = shiftDateKey(weekStart, -7, timezone);
  const startWin = getSalesDayRange(timezone, prevWeekStart);
  const endWin = getSalesDayRange(timezone, shiftDateKey(weekStart, 6, timezone));

  const [orders, refunds] = await Promise.all([
    fetchOrders(locationId, startWin.startAt, endWin.endAt, ORDER_STATES),
    fetchRefunds(locationId, startWin.startAt, endWin.endAt),
  ]);

  const dayCents = new Map<string, number>();
  for (const o of orders) {
    if (o.state !== "COMPLETED") continue;
    if (!o.createdAt) continue;
    const dk = localDateKey(o.createdAt, timezone);
    dayCents.set(dk, (dayCents.get(dk) ?? 0) + squareGrossSalesCents(o));
  }
  for (const r of refunds) {
    if (!r.createdAt) continue;
    const dk = localDateKey(r.createdAt, timezone);
    const amt = Number(r.amountMoney?.amount ?? 0n);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    dayCents.set(dk, (dayCents.get(dk) ?? 0) - amt);
  }

  function seven(mondayKey: string) {
    const daily: number[] = [];
    for (let i = 0; i < 7; i++) {
      const dk = shiftDateKey(mondayKey, i, timezone);
      const cents = dayCents.get(dk) ?? 0;
      daily.push(Math.round(cents) / 100);
    }
    const total = Math.round(daily.reduce((s, v) => s + v, 0) * 100) / 100;
    return { daily, total };
  }

  return {
    thisWeek: seven(weekStart),
    lastWeek: seven(prevWeekStart),
  };
}

/** Pull Gross Sales for a week from Square and write sales_weekly_daily. */
export async function warmWeekSalesCache(weekStart: string): Promise<number> {
  const { locationId, timezone, accessToken } = squareEnv;
  if (!locationId || !accessToken) return 0;

  const pair = await computeWeekPair(locationId, timezone, weekStart);
  const total = pair.thisWeek.total;
  if (total <= 0) return 0;

  adminDb()
    .collection("sales_weekly_daily")
    .doc(weekStart)
    .set(
      {
        weekStart,
        thisWeek: pair.thisWeek,
        lastWeek: pair.lastWeek,
        computedAt: Timestamp.now(),
      },
      { merge: true },
    )
    .catch((err) => console.warn("[square-weekly-daily] cache write failed:", err));

  return total;
}
