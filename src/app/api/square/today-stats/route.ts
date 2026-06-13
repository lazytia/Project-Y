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

    const RESTAURANT_STATES = ["OPEN", "COMPLETED"];

    // ── Weekly days (Mon → selectedDate), same 9am–10pm window as range-stats ─
    const weekRange = getWeekToDateRange(timezone, selectedDate);
    void weekRange; // used only to find Monday key
    const monKey = (() => {
      const noonLocal = new Date(
        new Date().toLocaleString("en-US", { timeZone: timezone }),
      );
      const dow = new Date(
        new Date(`${selectedDate}T12:00:00`).toLocaleString("en-US", { timeZone: timezone }),
      ).getDay();
      const daysSinceMon = (dow + 6) % 7;
      return shiftDateKey(selectedDate, -daysSinceMon, timezone);
    })();
    const weekDays: string[] = [];
    {
      const [sy, sm, sd] = monKey.split("-").map(Number);
      const cur = new Date(Date.UTC(sy, sm - 1, sd));
      const [ey, em, ed] = selectedDate.split("-").map(Number);
      const end = new Date(Date.UTC(ey, em - 1, ed));
      while (cur <= end) {
        weekDays.push(cur.toISOString().slice(0, 10));
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
    }

    void yesterdaySales9to10; // reserved for future yesterday-sales comparison
    const [
      todayOrders,
      yesterdayOrders,
      todayOrdersWindow,
      platterOrdersWindow,
      restaurantRefundsCents,
      platterRefundsCents,
      ...weekDayResults
    ] = await Promise.all([
      fetchOrders(locationId, today.startAt, today.endAt, RESTAURANT_STATES),
      fetchOrders(locationId, yesterday.startAt, yesterday.endAt, RESTAURANT_STATES),
      fetchOrders(locationId, todaySales9to10.startAt, todaySales9to10.endAt, RESTAURANT_STATES),
      platterLocationId
        ? fetchOrders(platterLocationId, todaySales9to10.startAt, todaySales9to10.endAt, ["COMPLETED"])
        : Promise.resolve([]),
      sumRefundCents(locationId, todaySales9to10.startAt, todaySales9to10.endAt),
      platterLocationId
        ? sumRefundCents(platterLocationId, todaySales9to10.startAt, todaySales9to10.endAt)
        : Promise.resolve(0),
      // per-day weekly fetches (4 promises per day: restOrders, platOrders, restRefunds, platRefunds)
      ...weekDays.flatMap((dk) => {
        const w = getSalesDayRange(timezone, dk);
        return [
          fetchOrders(locationId, w.startAt, w.endAt, RESTAURANT_STATES),
          platterLocationId
            ? fetchOrders(platterLocationId, w.startAt, w.endAt, ["COMPLETED"])
            : Promise.resolve([]),
          sumRefundCents(locationId, w.startAt, w.endAt),
          platterLocationId
            ? sumRefundCents(platterLocationId, w.startAt, w.endAt)
            : Promise.resolve(0),
        ] as [Promise<unknown>, Promise<unknown>, Promise<unknown>, Promise<unknown>];
      }),
    ] as const);

    // Reassemble per-day weekly results
    let weeklyProgress = 0;
    for (let i = 0; i < weekDays.length; i++) {
      const base = i * 4;
      const restOrders = weekDayResults[base] as Awaited<ReturnType<typeof fetchOrders>>;
      const platOrders = weekDayResults[base + 1] as Awaited<ReturnType<typeof fetchOrders>>;
      const restRef = weekDayResults[base + 2] as number;
      const platRef = weekDayResults[base + 3] as number;
      weeklyProgress +=
        sumDollars(restOrders, squareGrossSalesCents) - restRef / 100 +
        sumDollars(platOrders, squareGrossSalesCents) - platRef / 100;
    }

    // Transactions = restaurant order count (OPEN+COMPLETED, all-day).
    const transactions = todayOrders.length;
    const yestTransactions = yesterdayOrders.length;

    // ── Sales (Square Web "Gross sales" — 9am–10pm window, refunds removed) ─
    const restaurantSales =
      sumDollars(todayOrdersWindow, squareGrossSalesCents) - restaurantRefundsCents / 100;
    const platterSales =
      sumDollars(platterOrdersWindow, squareGrossSalesCents) - platterRefundsCents / 100;
    const todaySales = restaurantSales + platterSales;

    // (weeklyProgress computed above via per-day aggregation)

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
