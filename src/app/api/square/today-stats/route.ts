import { NextRequest, NextResponse } from "next/server";
import {
  getDateRange,
  getSalesDayRange,
  getWeekToDateRange,
  fetchOrders,
  sumRefundCents,
  squareEnv,
  netAmountCents,
  squareGrossSalesCents,
  todayDateKey,
} from "@/lib/square";

export const dynamic = "force-dynamic";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function formatHour(h: number): string {
  const fmt = (n: number) => {
    if (n === 0)  return "12:00 AM";
    if (n < 12)   return `${n}:00 AM`;
    if (n === 12) return "12:00 PM";
    return `${n - 12}:00 PM`;
  };
  return `${fmt(h)} – ${fmt(h + 1)}`;
}

function sumDollars<T>(orders: T[], cents: (o: T) => number): number {
  return orders.reduce((s, o) => s + cents(o), 0) / 100;
}

function shiftKey(dateKey: string, dayOffset: number): string {
  // Pure date math is enough — we only need to find "the day before" for
  // comparison purposes, and date-only arithmetic doesn't need TZ.
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + dayOffset);
  return dt.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const { locationId, platterLocationId, timezone, accessToken } = squareEnv;

  if (!locationId || !accessToken) {
    return NextResponse.json({ error: "Square not configured" }, { status: 500 });
  }

  const requestedDate = req.nextUrl.searchParams.get("date");
  const selectedDate =
    requestedDate && DATE_KEY_RE.test(requestedDate)
      ? requestedDate
      : todayDateKey(timezone);
  const isToday = selectedDate === todayDateKey(timezone);
  const prevDate = shiftKey(selectedDate, -1);

  try {
    // Sales window matches Square's Sales Summary: 9am–10pm AET.
    // "All-day" window kept for transactions / peak hour / best sellers etc.
    const today = getDateRange(timezone, 0, selectedDate);
    const yesterday = getDateRange(timezone, 0, prevDate);
    const todaySales9to10 = getSalesDayRange(timezone, selectedDate);
    const yesterdaySales9to10 = getSalesDayRange(timezone, prevDate);
    const week = getWeekToDateRange(timezone, selectedDate);

    const RESTAURANT_STATES = ["OPEN", "COMPLETED"];

    void yesterdaySales9to10; // reserved for future yesterday-sales comparison
    const [
      todayOrders,
      yesterdayOrders,
      todayOrdersWindow,
      platterOrdersWindow,
      weekRestaurantOrders,
      weekPlatterOrders,
      restaurantRefundsCents,
      platterRefundsCents,
    ] = await Promise.all([
      fetchOrders(locationId, today.startAt, today.endAt, RESTAURANT_STATES),
      fetchOrders(locationId, yesterday.startAt, yesterday.endAt, RESTAURANT_STATES),
      fetchOrders(locationId, todaySales9to10.startAt, todaySales9to10.endAt, RESTAURANT_STATES),
      platterLocationId
        ? fetchOrders(platterLocationId, todaySales9to10.startAt, todaySales9to10.endAt, ["COMPLETED"])
        : Promise.resolve([]),
      fetchOrders(locationId, week.startAt, week.endAt, RESTAURANT_STATES),
      platterLocationId
        ? fetchOrders(platterLocationId, week.startAt, week.endAt, ["COMPLETED"])
        : Promise.resolve([]),
      sumRefundCents(locationId, todaySales9to10.startAt, todaySales9to10.endAt),
      platterLocationId
        ? sumRefundCents(platterLocationId, todaySales9to10.startAt, todaySales9to10.endAt)
        : Promise.resolve(0),
    ]);

    // Transactions = restaurant order count (OPEN+COMPLETED, all-day).
    const transactions = todayOrders.length;
    const yestTransactions = yesterdayOrders.length;

    // ── Sales (Square Web "Gross sales" — 9am–10pm window, refunds removed) ─
    const restaurantSales =
      sumDollars(todayOrdersWindow, squareGrossSalesCents) - restaurantRefundsCents / 100;
    const platterSales =
      sumDollars(platterOrdersWindow, squareGrossSalesCents) - platterRefundsCents / 100;
    const todaySales = restaurantSales + platterSales;

    // ── Weekly Progress (same formula across the week-to-date span) ───
    const weeklyProgress =
      sumDollars(weekRestaurantOrders, squareGrossSalesCents) +
      sumDollars(weekPlatterOrders, squareGrossSalesCents);

    // ── Avg Net Sale (Net Sales ÷ 주문 수, Square 대시보드와 일치) ───
    const restaurantNet = sumDollars(todayOrders, netAmountCents);
    const avgSpend =
      transactions > 0
        ? Math.round((restaurantNet / transactions) * 100) / 100
        : 0;
    const yestNet = sumDollars(yesterdayOrders, netAmountCents);
    const yestAvgSpend =
      yestTransactions > 0
        ? Math.round((yestNet / yestTransactions) * 100) / 100
        : 0;

    // Best sellers still drawn from COMPLETED only (OPEN tickets might have
    // incomplete line items / no totalMoney rounding).
    const completedToday = todayOrders.filter((o) => o.state === "COMPLETED");

    // ── Peak Hour ────────────────────────────────────────────
    const hourCounts: Record<number, number> = {};
    for (const order of todayOrders) {
      if (order.createdAt) {
        const localDate = new Date(
          new Date(order.createdAt).toLocaleString("en-US", { timeZone: timezone }),
        );
        const h = localDate.getHours();
        hourCounts[h] = (hourCounts[h] ?? 0) + 1;
      }
    }
    const peakEntry = Object.entries(hourCounts).sort((a, b) => Number(b[1]) - Number(a[1]))[0];
    const peakHour = peakEntry ? formatHour(Number(peakEntry[0])) : null;
    const peakHourOrders = peakEntry ? Number(peakEntry[1]) : 0;

    // ── Best Sellers (COMPLETED 주문 기준) ─────────────────────
    const itemMap: Record<string, { sales: number; quantity: number }> = {};
    for (const order of completedToday) {
      for (const item of order.lineItems ?? []) {
        if (!item.name) continue;
        const sales = Number(item.totalMoney?.amount ?? 0n) / 100;
        if (sales <= 0) continue;
        const qty = parseFloat(item.quantity ?? "1");
        if (!itemMap[item.name]) itemMap[item.name] = { sales: 0, quantity: 0 };
        itemMap[item.name].sales += sales;
        itemMap[item.name].quantity += qty;
      }
    }
    const bestSellers = Object.entries(itemMap)
      .map(([name, d]) => ({ name, sales: Math.round(d.sales * 100) / 100, quantity: d.quantity }))
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 3);

    return NextResponse.json({
      date: selectedDate,
      isToday,
      todaySales,
      restaurantSales,
      platterSales,
      weeklyProgress,
      transactions,
      transactionsChange: transactions - yestTransactions,
      avgSpendPerTable: avgSpend,
      avgSpendChange: Math.round((avgSpend - yestAvgSpend) * 100) / 100,
      peakHour,
      peakHourOrders,
      bestSellers,
    });
  } catch (err) {
    console.error("[Square] today-stats error:", err);
    return NextResponse.json({ error: "Failed to fetch Square data" }, { status: 502 });
  }
}
