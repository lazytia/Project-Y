import { NextRequest, NextResponse } from "next/server";
import {
  getSalesDayRange,
  fetchOrders,
  sumRefundCents,
  squareEnv,
  squareGrossSalesCents,
  netAmountCents,
} from "@/lib/square";

export const dynamic = "force-dynamic";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function sumDollars<T>(orders: T[], cents: (o: T) => number): number {
  return orders.reduce((s, o) => s + cents(o), 0) / 100;
}

/** Enumerate every calendar date between startKey and endKey inclusive */
function dateRange(startKey: string, endKey: string): string[] {
  const keys: string[] = [];
  const [sy, sm, sd] = startKey.split("-").map(Number);
  const cur = new Date(Date.UTC(sy, sm - 1, sd));
  const [ey, em, ed] = endKey.split("-").map(Number);
  const end = new Date(Date.UTC(ey, em - 1, ed));
  while (cur <= end) {
    keys.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return keys;
}

export async function GET(req: NextRequest) {
  const { locationId, timezone, accessToken } = squareEnv;
  if (!locationId || !accessToken) {
    return NextResponse.json({ error: "Square not configured" }, { status: 500 });
  }

  const startDate = req.nextUrl.searchParams.get("startDate");
  const endDate   = req.nextUrl.searchParams.get("endDate");

  if (!startDate || !endDate || !DATE_KEY_RE.test(startDate) || !DATE_KEY_RE.test(endDate)) {
    return NextResponse.json({ error: "startDate and endDate required (YYYY-MM-DD)" }, { status: 400 });
  }
  if (startDate > endDate) {
    return NextResponse.json({ error: "startDate must be <= endDate" }, { status: 400 });
  }

  try {
    const days = dateRange(startDate, endDate);

    // Fetch each day's window in parallel (Square sales window 9am–10pm)
    const dayFetches = await Promise.all(
      days.map(async (dk) => {
        const w = getSalesDayRange(timezone, dk);
        const STATES = ["OPEN", "COMPLETED"];
        const [restOrders, restRefunds] = await Promise.all([
          fetchOrders(locationId, w.startAt, w.endAt, STATES),
          sumRefundCents(locationId, w.startAt, w.endAt),
        ]);
        return { restOrders, restRefunds };
      }),
    );

    // Aggregate
    let restaurantSales = 0;
    let transactions    = 0;
    const itemMap: Record<string, { sales: number; quantity: number }> = {};

    for (const { restOrders, restRefunds } of dayFetches) {
      restaurantSales += sumDollars(restOrders, squareGrossSalesCents) - restRefunds / 100;
      transactions    += restOrders.length;

      for (const order of restOrders.filter(o => o.state === "COMPLETED")) {
        for (const item of order.lineItems ?? []) {
          if (!item.name) continue;
          const sales = Number(item.totalMoney?.amount ?? 0n) / 100;
          if (sales <= 0) continue;
          const qty = parseFloat(item.quantity ?? "1");
          if (!itemMap[item.name]) itemMap[item.name] = { sales: 0, quantity: 0 };
          itemMap[item.name].sales    += sales;
          itemMap[item.name].quantity += qty;
        }
      }
    }

    const todaySales = restaurantSales;
    const avgSpendPerTable = transactions > 0
      ? Math.round((sumDollars(
          dayFetches.flatMap(d => d.restOrders), netAmountCents,
        ) / transactions) * 100) / 100
      : 0;

    const bestSellers = Object.entries(itemMap)
      .map(([name, d]) => ({ name, sales: Math.round(d.sales * 100) / 100, quantity: d.quantity }))
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 5);

    return NextResponse.json({
      startDate,
      endDate,
      days: days.length,
      todaySales,
      restaurantSales,
      transactions,
      avgSpendPerTable,
      bestSellers,
    });
  } catch (err) {
    console.error("[Square] range-stats error:", err);
    return NextResponse.json({ error: "Failed to fetch Square data" }, { status: 502 });
  }
}
