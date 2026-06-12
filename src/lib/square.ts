import { SquareClient, SquareEnvironment } from "square";

if (!process.env.SQUARE_ACCESS_TOKEN) {
  console.warn("[Square] SQUARE_ACCESS_TOKEN is not set");
}

export const squareClient = new SquareClient({
  token: process.env.SQUARE_ACCESS_TOKEN ?? "",
  environment:
    process.env.SQUARE_ENV === "production"
      ? SquareEnvironment.Production
      : SquareEnvironment.Sandbox,
});

/**
 * 로컬 시간 문자열 ("2026-06-12T00:00:00")을 해당 타임존 기준 UTC Date로 변환
 */
function zonedToUTC(localStr: string, timezone: string): Date {
  const approx = new Date(localStr + "Z");
  const tzLocal = approx.toLocaleString("sv-SE", { timeZone: timezone }).replace(" ", "T");
  return new Date(approx.getTime() + (approx.getTime() - new Date(tzLocal + "Z").getTime()));
}

/**
 * dayOffset: 0 = 오늘, -1 = 어제
 */
export function getDateRange(
  timezone = "UTC",
  dayOffset = 0,
): { startAt: string; endAt: string } {
  const target = new Date(Date.now() + dayOffset * 86_400_000);
  const dateStr = target.toLocaleDateString("en-CA", { timeZone: timezone }); // YYYY-MM-DD
  return {
    startAt: zonedToUTC(`${dateStr}T00:00:00`, timezone).toISOString(),
    endAt: zonedToUTC(`${dateStr}T23:59:59.999`, timezone).toISOString(),
  };
}

/** 페이지네이션 처리된 Orders 전체 조회 */
export async function fetchOrders(
  locationId: string,
  startAt: string,
  endAt: string,
  states: string[],
) {
  const orders: Awaited<ReturnType<typeof squareClient.orders.search>>["orders"] = [];
  let cursor: string | undefined;

  do {
    const res = await squareClient.orders.search({
      locationIds: [locationId],
      query: {
        filter: {
          dateTimeFilter: { createdAt: { startAt, endAt } },
          stateFilter: { states: states as import("square").OrderState[] },
        },
      },
      cursor,
      limit: 500,
    });
    orders.push(...(res.orders ?? []));
    cursor = res.cursor;
  } while (cursor);

  return orders;
}
