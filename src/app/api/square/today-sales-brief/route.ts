import { NextRequest, NextResponse } from "next/server";
import {
  getDateRange,
  getSalesDayRange,
  fetchOrders,
  sumRefundCents,
  squareEnv,
  squareGrossSalesCents,
  todayDateKey,
  SALES_DAY_START_HOUR,
  SALES_DAY_END_HOUR,
} from "@/lib/square";

export const dynamic = "force-dynamic";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

type SquareOrder = Awaited<ReturnType<typeof fetchOrders>>[number];

function inSalesWindow(order: SquareOrder, timezone: string): boolean {
  if (!order.createdAt) return false;
  const h = new Date(
    new Date(order.createdAt).toLocaleString("en-US", { timeZone: timezone }),
  ).getHours();
  return h >= SALES_DAY_START_HOUR && h < SALES_DAY_END_HOUR;
}

function sumDollars(orders: SquareOrder[]): number {
  return orders.reduce((s, o) => s + squareGrossSalesCents(o), 0) / 100;
}

/** Lightweight sales endpoint for manager/chef dashboard cards. */
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

  try {
    const today = getDateRange(timezone, 0, selectedDate);
    const todaySalesWindow = getSalesDayRange(timezone, selectedDate);

    const [todayOrders, platterTodayOrders, restaurantRefundsCents, platterRefundsCents] =
      await Promise.all([
        fetchOrders(locationId, today.startAt, today.endAt, ["OPEN", "COMPLETED"]),
        platterLocationId
          ? fetchOrders(platterLocationId, today.startAt, today.endAt, ["COMPLETED"])
          : Promise.resolve([]),
        sumRefundCents(locationId, todaySalesWindow.startAt, todaySalesWindow.endAt),
        platterLocationId
          ? sumRefundCents(platterLocationId, todaySalesWindow.startAt, todaySalesWindow.endAt)
          : Promise.resolve(0),
      ]);

    const todayOrdersWindow = todayOrders.filter((o) => inSalesWindow(o, timezone));
    const platterOrdersWindow = platterTodayOrders.filter((o) => inSalesWindow(o, timezone));
    const restaurantSales = sumDollars(todayOrdersWindow) - restaurantRefundsCents / 100;
    const platterSales = sumDollars(platterOrdersWindow) - platterRefundsCents / 100;

    return NextResponse.json({
      date: selectedDate,
      todaySales: restaurantSales + platterSales,
    });
  } catch (err) {
    console.error("[Square] today-sales-brief error:", err);
    return NextResponse.json({ error: "Failed to fetch Square data" }, { status: 502 });
  }
}
