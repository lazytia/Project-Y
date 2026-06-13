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
  shiftDateKey,
  SALES_DAY_START_HOUR,
  SALES_DAY_END_HOUR,
} from "@/lib/square";

export const dynamic = "force-dynamic";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

type SquareOrder = Awaited<ReturnType<typeof fetchOrders>>[number];

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
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + dayOffset);
  return dt.toISOString().slice(0, 10);
}

/** Returns true if the order's createdAt falls within the 9am–10pm sales window in the given timezone. */
function inSalesWindow(order: SquareOrder, timezone: string): boolean {
  if (!order.createdAt) return false;
  const h = new Date(
    new Date(order.createdAt).toLocaleString("en-US", { timeZone: timezone }),
  ).getHours();
  return h >= SALES_DAY_START_HOUR && h < SALES_DAY_END_HOUR;
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
    const today     = getDateRange(timezone, 0, selectedDate);
    const yesterday = getDateRange(timezone, 0, prevDate);
    const todaySalesWindow = getSalesDayRange(timezone, selectedDate);

    // Monday of the current week
    const dow = new Date(
      new Date(`${selectedDate}T12:00:00`).toLocaleString("en-US", { timeZone: timezone }),
    ).getDay();
    const monKey = shiftDateKey(selectedDate, -((dow + 6) % 7), timezone);
    const week = getWeekToDateRange(timezone, selectedDate);

    const RESTAURANT_STATES = ["OPEN", "COMPLETED"];

    // 9 parallel Square API calls (down from ~29)
    const [
      todayOrders,
      yesterdayOrders,
      platterTodayOrders,
      weekRestaurantOrders,
      weekPlatterOrders,
      restaurantRefundsCents,
      platterRefundsCents,
      weekRestaurantRefunds,
      weekPlatterRefunds,
    ] = await Promise.all([
      fetchOrders(locationId, today.startAt, today.endAt, RESTAURANT_STATES),
      fetchOrders(locationId, yesterday.startAt, yesterday.endAt, RESTAURANT_STATES),
      platterLocationId
        ? fetchOrders(platterLocationId, today.startAt, today.endAt, ["COMPLETED"])
        : Promise.resolve([]),
      // Single weekly window — filter 9am–10pm in memory
      fetchOrders(locationId, week.startAt, week.endAt, RESTAURANT_STATES),
      platterLocationId
        ? fetchOrders(platterLocationId, week.startAt, week.endAt, ["COMPLETED"])
        : Promise.resolve([]),
      sumRefundCents(locationId, todaySalesWindow.startAt, todaySalesWindow.endAt),
      platterLocationId
        ? sumRefundCents(platterLocationId, todaySalesWindow.startAt, todaySalesWindow.endAt)
        : Promise.resolve(0),
      sumRefundCents(locationId, week.startAt, week.endAt),
      platterLocationId
        ? sumRefundCents(platterLocationId, week.startAt, week.endAt)
        : Promise.resolve(0),
    ]);

    // Derive today's 9am–10pm orders from the full-day fetch (no extra API call)
    const todayOrdersWindow   = todayOrders.filter(o => inSalesWindow(o, timezone));
    const platterOrdersWindow = platterTodayOrders.filter(o => inSalesWindow(o, timezone));

    // Weekly progress: filter to 9am–10pm per day in memory, subtract weekly refunds
    const weeklyRestaurantInWindow = weekRestaurantOrders.filter(o => inSalesWindow(o, timezone));
    const weeklyPlatterInWindow    = weekPlatterOrders.filter(o => inSalesWindow(o, timezone));
    const weeklyProgress =
      sumDollars(weeklyRestaurantInWindow, squareGrossSalesCents) - weekRestaurantRefunds / 100 +
      sumDollars(weeklyPlatterInWindow, squareGrossSalesCents)    - weekPlatterRefunds / 100;

    // Transactions = restaurant order count (OPEN+COMPLETED, all-day)
    const transactions     = todayOrders.length;
    const yestTransactions = yesterdayOrders.length;

    // Sales (gross, 9am–10pm, refunds removed)
    const restaurantSales = sumDollars(todayOrdersWindow, squareGrossSalesCents) - restaurantRefundsCents / 100;
    const platterSales    = sumDollars(platterOrdersWindow, squareGrossSalesCents) - platterRefundsCents / 100;
    const todaySales      = restaurantSales + platterSales;

    // Avg net spend
    const restaurantNet = sumDollars(todayOrders, netAmountCents);
    const avgSpend =
      transactions > 0 ? Math.round((restaurantNet / transactions) * 100) / 100 : 0;
    const yestNet = sumDollars(yesterdayOrders, netAmountCents);
    const yestAvgSpend =
      yestTransactions > 0 ? Math.round((yestNet / yestTransactions) * 100) / 100 : 0;

    // Peak hour
    const hourCounts: Record<number, number> = {};
    for (const order of todayOrders) {
      if (order.createdAt) {
        const h = new Date(
          new Date(order.createdAt).toLocaleString("en-US", { timeZone: timezone }),
        ).getHours();
        hourCounts[h] = (hourCounts[h] ?? 0) + 1;
      }
    }
    const peakEntry     = Object.entries(hourCounts).sort((a, b) => Number(b[1]) - Number(a[1]))[0];
    const peakHour      = peakEntry ? formatHour(Number(peakEntry[0])) : null;
    const peakHourOrders = peakEntry ? Number(peakEntry[1]) : 0;

    // Best sellers (COMPLETED only)
    const itemMap: Record<string, { sales: number; quantity: number }> = {};
    for (const order of todayOrders.filter(o => o.state === "COMPLETED")) {
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
    const bestSellers = Object.entries(itemMap)
      .map(([name, d]) => ({ name, sales: Math.round(d.sales * 100) / 100, quantity: d.quantity }))
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 3);

    void monKey; // used for week boundary calculation above

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
