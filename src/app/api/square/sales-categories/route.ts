import { NextRequest, NextResponse } from "next/server";
import {
  fetchOrders,
  getSalesDayRange,
  shiftDateKey,
  squareClient,
  squareEnv,
} from "@/lib/square";

/**
 * GET /api/square/sales-categories?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 *
 * Returns per-category sales totals for the given date range, along with the
 * percentage change vs the equal-length window immediately preceding it.
 * Used by /money/sales to power the Sales By Category donut and the Best
 * Selling Categories row.
 */

export const dynamic = "force-dynamic";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ORDER_STATES = ["COMPLETED"];

type CatalogObject = {
  id?: string;
  type?: string;
  categoryData?: { name?: string };
  itemData?: {
    name?: string;
    categoryId?: string;
    categories?: { id?: string }[];
    variations?: { id?: string }[];
  };
  itemVariationData?: { itemId?: string };
};

async function loadCatalog() {
  const all: CatalogObject[] = [];
  const page = await squareClient.catalog.list({ types: "ITEM,CATEGORY,ITEM_VARIATION" });
  for await (const obj of page) all.push(obj as CatalogObject);
  return all;
}

/** Build maps: categoryId -> name, variationId -> categoryId (via item). */
function buildCatalogMaps(all: CatalogObject[]) {
  const categoryNameById = new Map<string, string>();
  for (const o of all) {
    if (o.type === "CATEGORY" && o.id && o.categoryData?.name) {
      categoryNameById.set(o.id, o.categoryData.name);
    }
  }

  const itemCategoryByItemId = new Map<string, string | null>();
  for (const o of all) {
    if (o.type !== "ITEM" || !o.id) continue;
    const d = o.itemData;
    let catId: string | null = null;
    if (d?.categoryId && categoryNameById.has(d.categoryId)) catId = d.categoryId;
    if (!catId && Array.isArray(d?.categories)) {
      for (const c of d!.categories!) {
        if (c.id && categoryNameById.has(c.id)) {
          catId = c.id;
          break;
        }
      }
    }
    itemCategoryByItemId.set(o.id, catId);
  }

  const itemIdByVariationId = new Map<string, string>();
  for (const o of all) {
    if (o.type !== "ITEM_VARIATION" || !o.id) continue;
    const parent = o.itemVariationData?.itemId;
    if (parent) itemIdByVariationId.set(o.id, parent);
  }

  return { categoryNameById, itemCategoryByItemId, itemIdByVariationId };
}

type LineItem = {
  name?: string | null;
  catalogObjectId?: string | null;
  quantity?: string | null;
  /** Matches Square Web Dashboard's "Gross Sales" — pre-discount, pre-tax
   *  line total. This is the figure the owner sees on Square Web, so we
   *  aggregate by it rather than totalMoney. */
  grossSalesMoney?: { amount?: bigint } | null;
};

async function bucketByCategory(
  locationId: string,
  startDate: string,
  endDate: string,
  timezone: string,
  maps: ReturnType<typeof buildCatalogMaps>,
): Promise<Map<string, { name: string; sales: number; quantity: number }>> {
  const startWindow = getSalesDayRange(timezone, startDate);
  const endWindow = getSalesDayRange(timezone, endDate);
  const orders = await fetchOrders(locationId, startWindow.startAt, endWindow.endAt, ORDER_STATES);
  const buckets = new Map<string, { name: string; sales: number; quantity: number }>();
  const UNCATEGORISED = "Uncategorised";

  for (const order of orders) {
    for (const line of (order.lineItems ?? []) as LineItem[]) {
      const amountCents = Number(line.grossSalesMoney?.amount ?? 0n);
      if (!Number.isFinite(amountCents) || amountCents <= 0) continue;
      const qty = parseFloat(line.quantity ?? "1") || 0;

      // catalogObjectId is usually an ITEM_VARIATION id — walk up to the
      // ITEM, then look up its category. Fall back to Uncategorised when
      // any hop breaks (deleted item, ad-hoc line, etc.).
      const variationId = line.catalogObjectId ?? undefined;
      const itemId = variationId ? maps.itemIdByVariationId.get(variationId) : undefined;
      const categoryId = itemId ? maps.itemCategoryByItemId.get(itemId) : null;
      const categoryName =
        categoryId && maps.categoryNameById.get(categoryId)
          ? (maps.categoryNameById.get(categoryId) as string)
          : UNCATEGORISED;

      const existing = buckets.get(categoryName);
      const salesDollars = amountCents / 100;
      if (existing) {
        existing.sales += salesDollars;
        existing.quantity += qty;
      } else {
        buckets.set(categoryName, { name: categoryName, sales: salesDollars, quantity: qty });
      }
    }
  }

  return buckets;
}

export async function GET(req: NextRequest) {
  const { locationId, timezone, accessToken } = squareEnv;
  if (!locationId || !accessToken) {
    return NextResponse.json({ error: "Square not configured" }, { status: 500 });
  }

  const startDate = req.nextUrl.searchParams.get("startDate");
  const endDate = req.nextUrl.searchParams.get("endDate");
  if (!startDate || !endDate || !DATE_KEY_RE.test(startDate) || !DATE_KEY_RE.test(endDate)) {
    return NextResponse.json(
      { error: "startDate and endDate required (YYYY-MM-DD)" },
      { status: 400 },
    );
  }
  if (startDate > endDate) {
    return NextResponse.json({ error: "startDate must be <= endDate" }, { status: 400 });
  }

  // Compute the "previous period" of equal length so we can show a delta.
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  const startDt = new Date(Date.UTC(sy, sm - 1, sd));
  const endDt = new Date(Date.UTC(ey, em - 1, ed));
  const days = Math.round((endDt.getTime() - startDt.getTime()) / 86_400_000) + 1;
  const prevEndDate = shiftDateKey(startDate, -1, timezone);
  const prevStartDate = shiftDateKey(prevEndDate, -(days - 1), timezone);

  try {
    const catalog = await loadCatalog();
    const maps = buildCatalogMaps(catalog);

    const [current, previous] = await Promise.all([
      bucketByCategory(locationId, startDate, endDate, timezone, maps),
      bucketByCategory(locationId, prevStartDate, prevEndDate, timezone, maps),
    ]);

    const merged: {
      name: string;
      sales: number;
      quantity: number;
      previousSales: number;
      deltaPct: number | null;
    }[] = [];

    const namesSeen = new Set<string>();
    for (const [name, cur] of current) {
      const prev = previous.get(name);
      const previousSales = prev?.sales ?? 0;
      const deltaPct =
        previousSales > 0
          ? ((cur.sales - previousSales) / previousSales) * 100
          : cur.sales > 0
            ? null
            : 0;
      merged.push({
        name,
        sales: Math.round(cur.sales * 100) / 100,
        quantity: cur.quantity,
        previousSales: Math.round(previousSales * 100) / 100,
        deltaPct: deltaPct === null ? null : Math.round(deltaPct * 10) / 10,
      });
      namesSeen.add(name);
    }
    // Categories that only had sales in the previous window are noise on
    // the donut but useful context for the deltas — skip them here.

    merged.sort((a, b) => b.sales - a.sales);
    const totalSales = merged.reduce((s, m) => s + m.sales, 0);

    return NextResponse.json({
      startDate,
      endDate,
      previousStartDate: prevStartDate,
      previousEndDate: prevEndDate,
      totalSales: Math.round(totalSales * 100) / 100,
      categories: merged,
    });
  } catch (err) {
    console.error("[Square] sales-categories error:", err);
    return NextResponse.json({ error: "Failed to fetch Square data" }, { status: 502 });
  }
}
