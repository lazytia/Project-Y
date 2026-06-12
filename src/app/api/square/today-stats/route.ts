import { NextResponse } from "next/server";
import { squareClient, getDateRange, fetchOrders } from "@/lib/square";

export const dynamic = "force-dynamic";

function formatHour(h: number): string {
  if (h === 0) return "12:00 AM";
  if (h < 12) return `${h}:00 AM`;
  if (h === 12) return "12:00 PM";
  return `${h - 12}:00 PM`;
}

export async function GET() {
  const locationId = process.env.SQUARE_LOCATION_ID;
  const timezone = process.env.SQUARE_TIMEZONE ?? "UTC";

  if (!locationId || !process.env.SQUARE_ACCESS_TOKEN) {
    return NextResponse.json({ error: "Square not configured" }, { status: 500 });
  }

  try {
    const today = getDateRange(timezone, 0);
    const yesterday = getDateRange(timezone, -1);

    // 오늘(OPEN+COMPLETED)과 어제(COMPLETED)를 병렬로 조회
    const [todayOrders, yesterdayOrders] = await Promise.all([
      fetchOrders(locationId, today.startAt, today.endAt, ["OPEN", "COMPLETED"]),
      fetchOrders(locationId, yesterday.startAt, yesterday.endAt, ["COMPLETED"]),
    ]);

    // ── Today Sales ──────────────────────────────────────────
    const todaySales =
      todayOrders.reduce((s, o) => s + Number(o.totalMoney?.amount ?? 0n), 0) / 100;

    // ── Transactions (완료된 건수) ────────────────────────────
    const transactions = todayOrders.filter((o) => o.state === "COMPLETED").length;
    const yestTransactions = yesterdayOrders.length;

    // ── Avg Spend Per Table ───────────────────────────────────
    const avgSpend =
      todayOrders.length > 0
        ? Math.round((todaySales / todayOrders.length) * 100) / 100
        : 0;
    const yestSales =
      yesterdayOrders.reduce((s, o) => s + Number(o.totalMoney?.amount ?? 0n), 0) / 100;
    const yestAvgSpend =
      yesterdayOrders.length > 0
        ? Math.round((yestSales / yesterdayOrders.length) * 100) / 100
        : 0;

    // ── Peak Hour ─────────────────────────────────────────────
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

    // ── Best Sellers ──────────────────────────────────────────
    const itemMap: Record<string, { sales: number; quantity: number }> = {};
    for (const order of todayOrders) {
      for (const item of order.lineItems ?? []) {
        if (!item.name) continue;
        const sales = Number(item.totalMoney?.amount ?? 0n) / 100;
        if (sales <= 0) continue; // 할인/마이너스 항목 제외
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
