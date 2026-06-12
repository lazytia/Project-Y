import { SquareClient, SquareEnvironment } from "square";

/**
 * Read an env var with surrounding whitespace (including stray CR/LF that
 * sometimes get baked into Secret Manager values) stripped. Empty strings
 * become undefined so `??` fallbacks work as expected.
 */
function env(name: string): string | undefined {
  const v = process.env[name];
  if (!v) return undefined;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export const squareEnv = {
  accessToken: env("SQUARE_ACCESS_TOKEN"),
  locationId: env("SQUARE_LOCATION_ID"),
  platterLocationId: env("SQUARE_PLATTER_LOCATION_ID"),
  timezone: env("SQUARE_TIMEZONE") ?? "UTC",
  isProd: env("SQUARE_ENV") === "production",
};

if (!squareEnv.accessToken) {
  console.warn("[Square] SQUARE_ACCESS_TOKEN is not set");
}

export const squareClient = new SquareClient({
  token: squareEnv.accessToken ?? "",
  environment: squareEnv.isProd
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

type SquareOrder = NonNullable<
  Awaited<ReturnType<typeof squareClient.orders.search>>["orders"]
>[number];

/**
 * Gross sales amount in cents — matches Square dashboard "Gross Sales":
 * line item base price × quantity, before discounts, taxes, tips, service charges.
 *
 * Derived per-order: total_money + discount - tax - tip - service_charge.
 * (total_money = items - discount + tax + tip + svc, so adding discount back
 * and stripping the add-ons returns to the pre-discount item subtotal.)
 */
export function grossAmountCents(order: SquareOrder): number {
  const total = Number(order.totalMoney?.amount ?? 0n);
  const discount = Number(order.totalDiscountMoney?.amount ?? 0n);
  const tax = Number(order.totalTaxMoney?.amount ?? 0n);
  const tip = Number(order.totalTipMoney?.amount ?? 0n);
  const svc = Number(order.totalServiceChargeMoney?.amount ?? 0n);
  return total + discount - tax - tip - svc;
}

/**
 * Monday 00:00 (local) → now (UTC ISO). Used for week-to-date metrics.
 */
export function getWeekToDateRange(timezone = "UTC"): {
  startAt: string;
  endAt: string;
} {
  const nowLocal = new Date(
    new Date().toLocaleString("en-US", { timeZone: timezone }),
  );
  const dow = nowLocal.getDay(); // 0=Sun..6=Sat
  const daysSinceMon = (dow + 6) % 7; // Mon=0, Sun=6
  const mon = new Date(nowLocal);
  mon.setDate(mon.getDate() - daysSinceMon);
  const dateStr = mon.toLocaleDateString("en-CA", { timeZone: timezone });

  return {
    startAt: zonedToUTC(`${dateStr}T00:00:00`, timezone).toISOString(),
    endAt: new Date().toISOString(),
  };
}

/** Count payments at a location within a time range (auto-paginated). */
export async function countPayments(
  locationId: string,
  beginTime: string,
  endTime: string,
): Promise<number> {
  let count = 0;
  const iter = await squareClient.payments.list({
    beginTime,
    endTime,
    locationId,
    limit: 100,
  });
  for await (const _ of iter) count++;
  return count;
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
