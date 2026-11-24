import { NextResponse, type NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { isOwnerOrChefEmail } from "@/lib/permissions";
import {
  deltaPct,
  groupOfCategory,
  type DishSales,
  type MenuWeek,
} from "@/lib/menu-performance";
import { fetchOrders, getSalesDayRange, shiftDateKey, squareClient, squareEnv } from "@/lib/square";
import { addDaysISO, isoMondayOf } from "@/lib/sydney-date";

/**
 * GET /api/square/menu-performance?weekStart=YYYY-MM-DD
 * Header:  Authorization: Bearer <Firebase ID token>
 *
 * Powers /operations/menu-performance: how many of each dish went out in a
 * week, and how that compares with the week before. What the restaurant sells
 * is the kitchen's and the owners', so anyone else is refused here rather than
 * only hidden in the menu.
 *
 * Counted the way the rest of the app counts sales: completed orders at the
 * restaurant, over Square's 9am–10pm business day. Platter is catering and
 * never part of this.
 *
 * Response: MenuWeek (see lib/menu-performance).
 */
export const dynamic = "force-dynamic";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ORDER_STATES = ["COMPLETED"];

/**
 * The menu, remembered for as long as a warm instance lives. It changes when
 * the owner edits it, which is not something a week's figures need to notice,
 * and it is 500-odd objects to walk.
 */
const CATALOG_TTL_MS = 10 * 60 * 1000;
let cachedCatalog: { at: number; maps: CatalogMaps } | null = null;

const CACHE_HEADERS = {
  // Five minutes in the reader's own browser. `private` because the answer is
  // only for someone whose token was checked above, which rules out the shared
  // cache `s-maxage` would otherwise set.
  "Cache-Control": "private, max-age=300",
} as const;

type CatalogObject = {
  id?: string;
  type?: string;
  categoryData?: { name?: string };
  itemData?: {
    name?: string;
    categoryId?: string;
    categories?: { id?: string }[];
  };
  itemVariationData?: { itemId?: string };
};

type CatalogMaps = {
  /** Variation id — what a line item carries — to the dish it belongs to. */
  itemIdByVariationId: Map<string, string>;
  nameByItemId: Map<string, string>;
  categoryByItemId: Map<string, string>;
};

async function loadCatalogMaps(): Promise<CatalogMaps> {
  if (cachedCatalog && Date.now() - cachedCatalog.at < CATALOG_TTL_MS) return cachedCatalog.maps;

  const all: CatalogObject[] = [];
  const page = await squareClient.catalog.list({ types: "ITEM,CATEGORY,ITEM_VARIATION" });
  for await (const obj of page) all.push(obj as CatalogObject);

  const categoryNameById = new Map<string, string>();
  for (const o of all) {
    if (o.type === "CATEGORY" && o.id && o.categoryData?.name) {
      categoryNameById.set(o.id, o.categoryData.name);
    }
  }

  const nameByItemId = new Map<string, string>();
  const categoryByItemId = new Map<string, string>();
  for (const o of all) {
    if (o.type !== "ITEM" || !o.id) continue;
    const d = o.itemData;
    if (d?.name) nameByItemId.set(o.id, d.name);
    // A dish can be filed under several categories; the first one Square
    // knows the name of is the one shown, as on the sales breakdown.
    let categoryId: string | null = null;
    if (d?.categoryId && categoryNameById.has(d.categoryId)) categoryId = d.categoryId;
    if (!categoryId) {
      for (const c of d?.categories ?? []) {
        if (c.id && categoryNameById.has(c.id)) {
          categoryId = c.id;
          break;
        }
      }
    }
    if (categoryId) categoryByItemId.set(o.id, categoryNameById.get(categoryId) as string);
  }

  const itemIdByVariationId = new Map<string, string>();
  for (const o of all) {
    if (o.type !== "ITEM_VARIATION" || !o.id) continue;
    const parent = o.itemVariationData?.itemId;
    if (parent) itemIdByVariationId.set(o.id, parent);
  }

  const maps = { itemIdByVariationId, nameByItemId, categoryByItemId };
  cachedCatalog = { at: Date.now(), maps };
  return maps;
}

type Counted = { name: string; category: string; qty: number };

/**
 * Every dish sold between two dates, by name.
 *
 * Keyed on the name rather than the catalogue id on purpose: the same dish is
 * listed under the dine-in and the takeaway menus as two items, and the
 * kitchen cooked the sum of them. A line Square cannot match to the menu —
 * an ad-hoc charge, or an item since deleted — keeps the name the order
 * carries and is counted under it.
 */
async function countDishes(
  locationId: string,
  startDate: string,
  endDate: string,
  timezone: string,
  maps: CatalogMaps,
): Promise<Map<string, Counted>> {
  const from = getSalesDayRange(timezone, startDate);
  const to = getSalesDayRange(timezone, endDate);
  const orders = await fetchOrders(locationId, from.startAt, to.endAt, ORDER_STATES);

  const counted = new Map<string, Counted>();
  for (const order of orders) {
    for (const line of order.lineItems ?? []) {
      const qty = parseFloat(line.quantity ?? "1") || 0;
      if (qty <= 0) continue;

      const itemId = line.catalogObjectId
        ? maps.itemIdByVariationId.get(line.catalogObjectId)
        : undefined;
      const name = (itemId ? maps.nameByItemId.get(itemId) : null) ?? line.name?.trim();
      if (!name) continue;
      const category = (itemId ? maps.categoryByItemId.get(itemId) : null) ?? "";

      const key = name.toLowerCase();
      const existing = counted.get(key);
      if (existing) {
        existing.qty += qty;
        if (!existing.category && category) existing.category = category;
      } else {
        counted.set(key, { name, category, qty });
      }
    }
  }
  return counted;
}

export async function GET(req: NextRequest) {
  const idToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!idToken) {
    return NextResponse.json({ error: "Missing bearer token." }, { status: 401 });
  }
  let email: string | null;
  try {
    email = (await adminAuth().verifyIdToken(idToken)).email ?? null;
  } catch {
    return NextResponse.json({ error: "Could not verify the sign-in." }, { status: 401 });
  }
  if (!isOwnerOrChefEmail(email)) {
    return NextResponse.json({ error: "Owners and the head chef only." }, { status: 403 });
  }

  const { locationId, timezone, accessToken } = squareEnv;
  if (!locationId || !accessToken) {
    return NextResponse.json({ error: "Square is not configured." }, { status: 500 });
  }

  const asked = req.nextUrl.searchParams.get("weekStart");
  if (!asked || !DATE_KEY_RE.test(asked)) {
    return NextResponse.json({ error: "weekStart required (YYYY-MM-DD)." }, { status: 400 });
  }
  // Any day of the week names its week, so a stale link cannot ask for six
  // days hanging off the end of one.
  const weekStart = isoMondayOf(asked);
  const weekEnd = addDaysISO(weekStart, 6);
  const previousWeekStart = shiftDateKey(weekStart, -7, timezone);
  const previousWeekEnd = addDaysISO(previousWeekStart, 6);

  try {
    const maps = await loadCatalogMaps();
    const [current, previous] = await Promise.all([
      countDishes(locationId, weekStart, weekEnd, timezone, maps),
      countDishes(locationId, previousWeekStart, previousWeekEnd, timezone, maps),
    ]);

    // Only what sold this week is listed: a dish that sold last week and not
    // this one is a row of zeroes, and the page is read for what is moving.
    const dishes: DishSales[] = [...current.values()]
      .map((d) => {
        const previousQty = previous.get(d.name.toLowerCase())?.qty ?? 0;
        return {
          name: d.name,
          category: d.category,
          group: groupOfCategory(d.category),
          qty: Math.round(d.qty * 100) / 100,
          previousQty: Math.round(previousQty * 100) / 100,
          deltaPct: deltaPct(d.qty, previousQty),
        };
      })
      .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));

    const totalQty = dishes.reduce((sum, d) => sum + d.qty, 0);
    const previousTotalQty = [...previous.values()].reduce((sum, d) => sum + d.qty, 0);

    const body: MenuWeek = {
      weekStart,
      weekEnd,
      previousWeekStart,
      previousWeekEnd,
      totalQty: Math.round(totalQty),
      previousTotalQty: Math.round(previousTotalQty),
      totalDeltaPct: deltaPct(totalQty, previousTotalQty),
      dishCount: dishes.length,
      dishes,
    };
    return NextResponse.json(body, { headers: CACHE_HEADERS });
  } catch (err) {
    console.error("[menu-performance] Square read failed:", err);
    return NextResponse.json({ error: "Could not read the week's sales." }, { status: 502 });
  }
}
