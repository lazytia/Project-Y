import { NextRequest, NextResponse } from "next/server";
import {
  getDateRange,
  getWeekToDateRange,
  fetchOrders,
  squareEnv,
  grossAmountCents,
  todayDateKey,
} from "@/lib/square";

export const dynamic = "force-dynamic";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function formatHour(h: number): string {
  if (h === 0) return "12:00 AM";
  if (h < 12) return `${h}:00 AM`;
  if (h === 12) return "12:00 PM";
  return `${h - 12}:00 PM`;
}

function sumGrossDollars<T>(orders: T[], grossFn: (o: T) => number): number {
  return orders.reduce((s, o) => s + grossFn(o), 0) / 100;
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
    const today = getDateRange(timezone, 0, selectedDate);
    const yesterday = getDateRange(timezone, 0, prevDate);
    const week = getWeekToDateRange(timezone, selectedDate);

    // Restaurant: OPEN+COMPLETED always — OPEN tickets are paid-but-not-closed
    // (Square dashboard counts these in Sales). Even on past dates they may
    // legitimately remain open. Platter: COMPLETED only (OPEN platter = future
    // catering reservation, not yet revenue).
    const RESTAURANT_STATES = ["OPEN", "COMPLETED"];

    const [
      todayOrders,
      yesterdayOrders,
      platterOrders,
      weekRestaurantOrders,
      weekPlatterOrders,
    ] = await Promise.all([
      fetchOrders(locationId, today.startAt, today.endAt, RESTAURANT_STATES),
      fetchOrders(locationId, yesterday.startAt, yesterday.endAt, RESTAURANT_STATES),
      platterLocationId
        ? fetchOrders(platterLocationId, today.startAt, today.endAt, ["COMPLETED"])
        : Promise.resolve([]),
      fetchOrders(locationId, week.startAt, week.endAt, RESTAURANT_STATES),
      platterLocationId
        ? fetchOrders(platterLocationId, week.startAt, week.endAt, ["COMPLETED"])
        : Promise.resolve([]),
    ]);

    // Transactions = restaurant order count (OPEN+COMPLETED). Matches Square
    // dashboard which counts orders, not payments (split bills can make
    // payments > orders, but the dashboard sticks with order count).
    const transactions = todayOrders.length;
    const yestTransactions = yesterdayOrders.length;

    // ── Sales (gross — 세전·할인 전) ───────────────────────────
    const restaurantSales = sumGrossDollars(todayOrders, grossAmountCents);
    const platterSales = sumGrossDollars(platterOrders, grossAmountCents);
    const todaySales = restaurantSales + platterSales;

    // ── Weekly Progress (Mon~선택일) — restaurant OPEN+COMPLETED, platter COMPLETED ─
    const weeklyProgress =
      sumGrossDollars(weekRestaurantOrders, grossAmountCents) +
      sumGrossDollars(weekPlatterOrders, grossAmountCents);

    // ── Avg Spend Per Table (restaurant gross ÷ restaurant order count) ──
    const avgSpend =
      transactions > 0
        ? Math.round((restaurantSales / transactions) * 100) / 100
        : 0;
    const yestSales = sumGrossDollars(yesterdayOrders, grossAmountCents);
    const yestAvgSpend =
      yestTransactions > 0
        ? Math.round((yestSales / yestTransactions) * 100) / 100
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
