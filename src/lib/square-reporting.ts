/**
 * Square Reporting API — same figures as Square Dashboard -> Reports -> Sales summary.
 * https://developer.squareup.com/docs/reporting-api
 *
 * AU Sales Summary "Gross sales" row = Net sales + Taxes (not Product sales / Items).
 */
import { squareEnv } from "@/lib/square";

const REPORTING_BASE = "https://connect.squareup.com/reporting";

/** Dashboard Sales summary -> Gross sales row (net sales + taxes). */
const GROSS_SALES_MEASURES = ["Sales.net_sales", "Sales.sales_tax_amount"] as const;
const REPORTING_TIME_DIM = "Sales.local_reporting_timestamp";
const LOCATION_DIM = "Sales.location_id";

type ReportingQuery = Record<string, unknown>;

type ReportingLoadResponse = {
  data?: Record<string, string | number | null>[];
  error?: string;
};

function parseMoney(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function grossFromRow(row: Record<string, string | number | null>): number {
  return parseMoney(row["Sales.net_sales"]) + parseMoney(row["Sales.sales_tax_amount"]);
}

async function reportingLoad(query: ReportingQuery, maxAttempts = 12): Promise<ReportingLoadResponse> {
  const token = squareEnv.accessToken;
  if (!token) throw new Error("SQUARE_ACCESS_TOKEN not set");

  const delays = [2, 2, 3, 3, 5, 5, 8, 8, 10, 10, 15, 20];
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const res = await fetch(REPORTING_BASE + "/v1/load", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error("Reporting API " + res.status + ": " + text.slice(0, 300));
    }

    const body = (await res.json()) as ReportingLoadResponse;
    if (body.error === "Continue wait") {
      const delayMs = (delays[attempt] ?? 20) * 1000;
      await new Promise((r) => setTimeout(r, delayMs));
      continue;
    }
    return body;
  }
  throw new Error("Reporting API query timed out (Continue wait)");
}

/** Monthly gross sales for one calendar year, main location only. */
export async function fetchYearlyGrossSalesFromReporting(
  year: string,
  locationId: string,
): Promise<{ monthly: number[]; total: number }> {
  const timezone = squareEnv.timezone ?? "Australia/Sydney";
  const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: timezone });
  const yearEnd = year + "-12-31";
  const endDate = year === todayKey.slice(0, 4) && todayKey < yearEnd ? todayKey : yearEnd;

  const locationFilter = {
    member: LOCATION_DIM,
    operator: "equals",
    values: [locationId],
  };

  const dateRange = [year + "-01-01", endDate];

  const [monthlyRes, totalRes] = await Promise.all([
    reportingLoad({
      measures: [...GROSS_SALES_MEASURES],
      filters: [locationFilter],
      timeDimensions: [
        {
          dimension: REPORTING_TIME_DIM,
          dateRange,
          granularity: "month",
        },
      ],
    }),
    reportingLoad({
      measures: [...GROSS_SALES_MEASURES],
      filters: [locationFilter],
      timeDimensions: [
        {
          dimension: REPORTING_TIME_DIM,
          dateRange,
        },
      ],
    }),
  ]);

  const monthly = new Array(12).fill(0);
  for (const row of monthlyRes.data ?? []) {
    const monthKey = Object.keys(row).find((k) => k.endsWith(".month"));
    const rawMonth = monthKey ? row[monthKey] : null;
    if (typeof rawMonth !== "string") continue;
    const m = new Date(rawMonth).getUTCMonth();
    if (m < 0 || m > 11) continue;
    monthly[m] = Math.round(grossFromRow(row) * 100) / 100;
  }

  const totalRow = totalRes.data?.[0];
  const totalFromApi = totalRow
    ? Math.round(grossFromRow(totalRow) * 100) / 100
    : Math.round(monthly.reduce((s, v) => s + v, 0) * 100) / 100;

  return { monthly, total: totalFromApi };
}

/** Daily gross sales (Sales Summary row) for a calendar date range. */
export async function fetchDailyGrossSalesFromReporting(
  startDate: string,
  endDate: string,
  locationId: string,
): Promise<Map<string, number>> {
  const locationFilter = {
    member: LOCATION_DIM,
    operator: "equals",
    values: [locationId],
  };

  const res = await reportingLoad({
    measures: [...GROSS_SALES_MEASURES],
    filters: [locationFilter],
    timeDimensions: [
      {
        dimension: REPORTING_TIME_DIM,
        dateRange: [startDate, endDate],
        granularity: "day",
      },
    ],
  });

  const daily = new Map<string, number>();
  for (const row of res.data ?? []) {
    const dayKey = Object.keys(row).find((k) => k.endsWith(".day"));
    const rawDay = dayKey ? row[dayKey] : null;
    if (typeof rawDay !== "string") continue;
    const dk = rawDay.slice(0, 10);
    daily.set(dk, Math.round(grossFromRow(row) * 100) / 100);
  }
  return daily;
}

export const squareReportingGrossSalesMeta = {
  formula: "Sales.net_sales + Sales.sales_tax_amount",
  measures: GROSS_SALES_MEASURES,
} as const;
