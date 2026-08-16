import { NextRequest, NextResponse } from "next/server";
import {
  getDateRange,
  getSalesDayRange,
  fetchOrders,
  isLunchInstant,
  localHourIn,
  sumRefundCentsByService,
  squareEnv,
  netAmountCents,
  squareGrossSalesCents,
  todayDateKey,
  SALES_DAY_START_HOUR,
  SALES_DAY_END_HOUR,
} from "@/lib/square";

/**
 * Every figure below is derived from ONE day of orders plus that day's
 * refunds. Anything needing a second Square sweep has been dropped: the
 * owner dashboard is the only caller and it rendered none of it, yet the
 * extra week-wide (paginated) and previous-day sweeps roughly doubled this
 * route's response time on every dashboard open.
 *
 * Removed with their sweeps: weeklyProgress (the week card reads
 * /api/square/weekly-daily, falling back to the sales_weekly doc) and
 * transactionsChange / avgSpendChange (never displayed).
 */

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

/** Returns true if the order's createdAt falls within the 9am–10pm sales window in the given timezone. */
function inSalesWindow(order: SquareOrder, timezone: string): boolean {
  if (!order.createdAt) return false;
  const h = localHourIn(order.createdAt, timezone);
  return h >= SALES_DAY_START_HOUR && h < SALES_DAY_END_HOUR;
}

/** Split windowed orders at 3:00 PM. Every windowed order has a createdAt,
 *  so the two buckets always add back up to the day's total. */
function splitByService(orders: SquareOrder[], timezone: string) {
  const lunch: SquareOrder[] = [];
  const dinner: SquareOrder[] = [];
  for (const o of orders) {
    (isLunchInstant(o.createdAt!, timezone) ? lunch : dinner).push(o);
  }
  return { lunch, dinner };
}

export async function GET(req: NextRequest) {
  const { locationId, timezone, accessToken } = squareEnv;

  if (!locationId || !accessToken) {
    return NextResponse.json({ error: "Square not configured" }, { status: 500 });
  }

  const requestedDate = req.nextUrl.searchParams.get("date");
  const selectedDate =
    requestedDate && DATE_KEY_RE.test(requestedDate)
      ? requestedDate
      : todayDateKey(timezone);
  const isToday = selectedDate === todayDateKey(timezone);

  try {
    const today = getDateRange(timezone, 0, selectedDate);
    const todaySalesWindow = getSalesDayRange(timezone, selectedDate);

    const RESTAURANT_STATES = ["OPEN", "COMPLETED"];

    const [todayOrders, restaurantRefunds] = await Promise.all([
      fetchOrders(locationId, today.startAt, today.endAt, RESTAURANT_STATES),
      sumRefundCentsByService(
        locationId,
        todaySalesWindow.startAt,
        todaySalesWindow.endAt,
        timezone,
      ),
    ]);

    // Derive today's 9am–10pm orders from the full-day fetch (no extra API call)
    const todayOrdersWindow = todayOrders.filter(o => inSalesWindow(o, timezone));

    // Transactions = restaurant order count (OPEN+COMPLETED, all-day)
    const transactions = todayOrders.length;

    // Sales (gross, 9am–10pm, refunds removed)
    const todaySales = sumDollars(todayOrdersWindow, squareGrossSalesCents)
      - (restaurantRefunds.lunch + restaurantRefunds.dinner) / 100;

    // Same money, cut at 3:00 PM — lunchSales + dinnerSales === todaySales.
    const restaurantByService = splitByService(todayOrdersWindow, timezone);
    const serviceSales = (meal: "lunch" | "dinner") =>
      sumDollars(restaurantByService[meal], squareGrossSalesCents)
      - restaurantRefunds[meal] / 100;
    const lunchSales  = serviceSales("lunch");
    const dinnerSales = serviceSales("dinner");

    // Avg net spend
    const restaurantNet = sumDollars(todayOrders, netAmountCents);
    const avgSpend =
      transactions > 0 ? Math.round((restaurantNet / transactions) * 100) / 100 : 0;

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

    return NextResponse.json({
      date: selectedDate,
      isToday,
      todaySales,
      lunchSales,
      dinnerSales,
      transactions,
      avgSpendPerTable: avgSpend,
      peakHour,
      peakHourOrders,
      bestSellers,
    });
  } catch (err) {
    console.error("[Square] today-stats error:", err);
    return NextResponse.json({ error: "Failed to fetch Square data" }, { status: 502 });
  }
}
