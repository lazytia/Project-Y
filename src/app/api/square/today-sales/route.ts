import { NextResponse } from "next/server";
import { squareClient, getDateRange } from "@/lib/square";

export const dynamic = "force-dynamic";

export async function GET() {
  const locationId = process.env.SQUARE_LOCATION_ID;
  const timezone = process.env.SQUARE_TIMEZONE ?? "UTC";

  if (!locationId) {
    return NextResponse.json(
      { error: "SQUARE_LOCATION_ID is not configured" },
      { status: 500 },
    );
  }

  if (!process.env.SQUARE_ACCESS_TOKEN) {
    return NextResponse.json(
      { error: "SQUARE_ACCESS_TOKEN is not configured" },
      { status: 500 },
    );
  }

  try {
    const { startAt, endAt } = getDateRange(timezone, 0);
    let total = 0n; // Square 금액은 BigInt (cents 단위)
    let cursor: string | undefined = undefined;

    // 페이지네이션으로 오늘의 모든 오더 합산
    do {
      const response = await squareClient.orders.search({
        locationIds: [locationId],
        query: {
          filter: {
            dateTimeFilter: {
              createdAt: { startAt, endAt },
            },
            stateFilter: {
              // OPEN: 계산 전 오픈 티켓, COMPLETED: 계산 완료
              states: ["OPEN", "COMPLETED"],
            },
          },
        },
        cursor,
        limit: 500,
      });

      const orders = response.orders ?? [];
      for (const order of orders) {
        // totalMoney: 세금·할인 포함 총액 (cents)
        total += order.totalMoney?.amount ?? 0n;
      }

      cursor = response.cursor;
    } while (cursor);

    return NextResponse.json({
      // cents → dollars
      total: Number(total) / 100,
    });
  } catch (err) {
    console.error("[Square] today-sales error:", err);
    return NextResponse.json(
      { error: "Failed to fetch Square data" },
      { status: 502 },
    );
  }
}
