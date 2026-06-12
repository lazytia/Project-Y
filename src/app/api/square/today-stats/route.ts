import { NextResponse } from "next/server";
import {
  getDateRange,
  getWeekToDateRange,
  fetchOrders,
  countPayments,
  squareEnv,
  grossAmountCents,
} from "@/lib/square";

export const dynamic = "force-dynamic";

function formatHour(h: number): string {
  if (h === 0) return "12:00 AM";
  if (h < 12) return `${h}:00 AM`;
  if (h === 12) return "12:00 PM";
  return `${h - 12}:00 PM`;
}

function sumGrossDollars<T>(orders: T[], grossFn: (o: T) => number): number {
  return orders.reduce((s, o) => s + grossFn(o), 0) / 100;
}

export async function GET() {
  const { locationId, platterLocationId, timezone, accessToken } = squareEnv;

  if (!locationId || !accessToken) {
    return NextResponse.json({ error: "Square not configured" }, { status: 500 });
  }

  try {
    const today = getDateRange(timezone, 0);
    const yesterday = getDateRange(timezone, -1);
    const week = getWeekToDateRange(timezone);

    const [
      todayOrders,
      yesterdayOrders,
      platterOrders,
      weekRestaurantOrders,
      weekPlatterOrders,
      transactions,
      yestTransactions,
    ] = await Promise.all([
      fetchOrders(locationId, today.startAt, today.endAt, ["OPEN", "COMPLETED"]),
      fetchOrders(locationId, yesterday.startAt, yesterday.endAt, ["COMPLETED"]),
      platterLocationId
        ? fetchOrders(platterLocationId, today.startAt, today.endAt, ["OPEN", "COMPLETED"])
        : Promise.resolve([]),
      fetchOrders(locationId, week.startAt, week.endAt, ["COMPLETED"]),
      platterLocationId
        ? fetchOrders(platterLocationId, week.startAt, week.endAt, ["COMPLETED"])
        : Promise.resolve([]),
      countPayments(locationId, today.startAt, today.endAt),
      countPayments(locationId, yesterday.startAt, yesterday.endAt),
    ]);

    // ── Sales 집계 (gross — 세전·할인 적용 전) ────────────────
    // Restaurant: OPEN+COMPLETED (실시간 매장 활동)
    // Platter:   COMPLETED만 (OPEN은 미래 케이터링 예약)
    const restaurantSales = sumGrossDollars(todayOrders, grossAmountCents);
    const completedPlatter = platterOrders.filter((o) => o.state === "COMPLETED");
    const platterSales = sumGrossDollars(completedPlatter, grossAmountCents);
    const todaySales = restaurantSales + platterSales;

    // ── Weekly Progress (Mon-now, COMPLETED 양쪽 location 합산, gross) ─
    const weeklyProgress =
      sumGrossDollars(weekRestaurantOrders, grossAmountCents) +
      sumGrossDollars(weekPlatterOrders, grossAmountCents);

    // ── Avg Spend Per Table (COMPLETED gross ÷ COMPLETED 주문 수) ─
    // 1주문 = 1테이블 기준 평균 객단가 (Square 대시보드 표준).
    // 분할결제(payments 건수)는 Transactions 카드와 별개로 둠.
    const completedToday = todayOrders.filter((o) => o.state === "COMPLETED");
    const restaurantCompletedGross = sumGrossDollars(completedToday, grossAmountCents);
    const avgSpend =
      completedToday.length > 0
        ? Math.round((restaurantCompletedGross / completedToday.length) * 100) / 100
        : 0;
    // yesterdayOrders는 fetchOrders에서 ["COMPLETED"]로 받았으므로 그대로 분모로 사용
    const yestSales = sumGrossDollars(yesterdayOrders, grossAmountCents);
    const yestAvgSpend =
      yesterdayOrders.length > 0
        ? Math.round((yestSales / yesterdayOrders.length) * 100) / 100
        : 0;

    // ── Peak Hour (활동량 지표, OPEN 포함) ───────────────────
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

    // ── Best Sellers (COMPLETED 주문, restaurant 매장) ────────
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
