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

/** Calendar date key (YYYY-MM-DD) for the current moment in the given TZ. */
export function todayDateKey(timezone = "UTC"): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: timezone });
}

/**
 * UTC range covering one full calendar day in the given timezone.
 * If `dateKey` is omitted, defaults to today + dayOffset days.
 */
export function getDateRange(
  timezone = "UTC",
  dayOffset = 0,
  dateKey?: string,
): { startAt: string; endAt: string; dateKey: string } {
  let dk = dateKey;
  if (!dk) {
    const target = new Date(Date.now() + dayOffset * 86_400_000);
    dk = target.toLocaleDateString("en-CA", { timeZone: timezone });
  }
  return {
    dateKey: dk,
    startAt: zonedToUTC(`${dk}T00:00:00`, timezone).toISOString(),
    endAt: zonedToUTC(`${dk}T23:59:59.999`, timezone).toISOString(),
  };
}

/** Calendar date key shifted by N days in the given timezone. */
export function shiftDateKey(dateKey: string, dayOffset: number, timezone = "UTC"): string {
  const noon = zonedToUTC(`${dateKey}T12:00:00`, timezone);
  const shifted = new Date(noon.getTime() + dayOffset * 86_400_000);
  return shifted.toLocaleDateString("en-CA", { timeZone: timezone });
}

type SquareOrder = NonNullable<
  Awaited<ReturnType<typeof squareClient.orders.search>>["orders"]
>[number];

/**
 * Gross sales amount in cents — items × qty, before discount/tax/tip/svc.
 * Derived: total_money + discount - tax - tip - service_charge.
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
 * Net sales amount in cents — items minus discounts, before tax/tip/svc.
 * Matches Square dashboard "Net Sales" (used for "Avg Net Sale").
 */
export function netAmountCents(order: SquareOrder): number {
  const total = Number(order.totalMoney?.amount ?? 0n);
  const tax = Number(order.totalTaxMoney?.amount ?? 0n);
  const tip = Number(order.totalTipMoney?.amount ?? 0n);
  const svc = Number(order.totalServiceChargeMoney?.amount ?? 0n);
  return total - tax - tip - svc;
}

/**
 * Total collected amount in cents — what the customer actually paid.
 * Matches Square dashboard "Sales" (= total_money, including tax/tip/svc).
 */
export function totalCollectedCents(order: SquareOrder): number {
  return Number(order.totalMoney?.amount ?? 0n);
}

/**
 * Monday 00:00 (local) of the week containing `dateKey` through 23:59:59 of
 * `dateKey` — inclusive week-to-date through the selected day.
 * If `dateKey` is omitted, uses today (Sydney → now wall clock).
 */
export function getWeekToDateRange(
  timezone = "UTC",
  dateKey?: string,
): { startAt: string; endAt: string } {
  const refDateKey = dateKey ?? todayDateKey(timezone);
  // dow at noon avoids DST edge cases
  const noonLocal = new Date(
    zonedToUTC(`${refDateKey}T12:00:00`, timezone),
  );
  const dow = new Date(
    noonLocal.toLocaleString("en-US", { timeZone: timezone }),
  ).getDay();
  const daysSinceMon = (dow + 6) % 7; // Mon=0, Sun=6
  const monKey = shiftDateKey(refDateKey, -daysSinceMon, timezone);

  // For today: end-at-now (in-progress week). For past dates: end of that day.
  const isToday = refDateKey === todayDateKey(timezone);
  const endAt = isToday
    ? new Date().toISOString()
    : zonedToUTC(`${refDateKey}T23:59:59.999`, timezone).toISOString();

  return {
    startAt: zonedToUTC(`${monKey}T00:00:00`, timezone).toISOString(),
    endAt,
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
    // sortField is required by the API even when defaulted in docs; without it
    // the SDK sends an empty string which Square rejects as INVALID_ENUM_VALUE.
    sortField: "CREATED_AT",
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
