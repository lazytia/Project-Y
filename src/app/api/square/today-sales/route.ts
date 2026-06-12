import { NextResponse } from "next/server";
import { squareClient, getDateRange, squareEnv, grossAmountCents } from "@/lib/square";

export const dynamic = "force-dynamic";

export async function GET() {
  const { locationId, timezone, accessToken } = squareEnv;

  if (!locationId) {
    return NextResponse.json(
      { error: "SQUARE_LOCATION_ID is not configured" },
      { status: 500 },
    );
  }

  if (!accessToken) {
    return NextResponse.json(
      { error: "SQUARE_ACCESS_TOKEN is not configured" },
      { status: 500 },
    );
  }

  try {
    const { startAt, endAt } = getDateRange(timezone, 0);
    let totalCents = 0;
    let cursor: string | undefined = undefined;

    // Restaurant 매장 실시간 매출: OPEN(진행 중 테이블) + COMPLETED 모두 합산, 세전·할인 전
    do {
      const response = await squareClient.orders.search({
        locationIds: [locationId],
        query: {
          filter: {
            dateTimeFilter: { createdAt: { startAt, endAt } },
            stateFilter: { states: ["OPEN", "COMPLETED"] },
          },
        },
        cursor,
        limit: 500,
      });

      for (const order of response.orders ?? []) {
        totalCents += grossAmountCents(order);
      }

      cursor = response.cursor;
    } while (cursor);

    return NextResponse.json({ total: totalCents / 100 });
  } catch (err) {
    console.error("[Square] today-sales error:", err);
    return NextResponse.json(
      { error: "Failed to fetch Square data" },
      { status: 502 },
    );
  }
}
