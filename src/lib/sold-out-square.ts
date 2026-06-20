/**
 * Shared helpers for syncing the Daily Sold Out state to Square.
 *
 * Strategy (both at once, so dashboard + POS reflect the change):
 *  1. Flip the ITEM's `presentAtAllLocations` flag → drives the
 *     Available/Unavailable Status pill in Square Dashboard's
 *     "Manage inventory" section.
 *  2. Flip each ITEM_VARIATION's per-location `soldOut` override →
 *     drives the red "Sold Out" badge on POS + Online Ordering.
 */
import { squareClient, squareEnv } from "@/lib/square";

export type CategoryDef = {
  id: string;
  match: RegExp;
};

export const SOLD_OUT_CATEGORIES: CategoryDef[] = [
  { id: "squid", match: /\b(squid|ika)\b/i },
  { id: "snapper", match: /\bsnapper\b/i },
  { id: "trevally", match: /\btrevally\b/i },
  { id: "tuna", match: /\btuna\b/i },
];

type LocationOverride = {
  locationId?: string;
  soldOut?: boolean;
  soldOutValidUntil?: string;
  [k: string]: unknown;
};

type Variation = {
  id?: string;
  type?: string;
  version?: number | bigint;
  itemVariationData?: {
    name?: string;
    itemId?: string;
    locationOverrides?: LocationOverride[];
    [k: string]: unknown;
  };
  [k: string]: unknown;
};

type CatalogObject = {
  id?: string;
  type?: string;
  version?: number | bigint;
  presentAtAllLocations?: boolean;
  categoryData?: { name?: string };
  itemData?: {
    name?: string;
    categories?: { id?: string }[];
    categoryId?: string;
    variations?: Variation[];
  };
  [k: string]: unknown;
};

async function listAllCatalog(): Promise<CatalogObject[]> {
  const out: CatalogObject[] = [];
  const page = await squareClient.catalog.list({ types: "ITEM,CATEGORY" });
  for await (const obj of page) {
    out.push(obj as CatalogObject);
  }
  return out;
}

let cachedLocationIds: string[] | null = null;
async function listLocationIds(): Promise<string[]> {
  if (cachedLocationIds) return cachedLocationIds;
  const ids = new Set<string>();
  if (squareEnv.locationId) ids.add(squareEnv.locationId);
  if (squareEnv.platterLocationId) ids.add(squareEnv.platterLocationId);
  try {
    const resp = await squareClient.locations.list();
    const list = (resp as { locations?: { id?: string }[] }).locations ?? [];
    for (const loc of list) if (loc.id) ids.add(loc.id);
  } catch {
    // fall back to env-derived ids only
  }
  cachedLocationIds = Array.from(ids);
  return cachedLocationIds;
}

function itemsInCategory(all: CatalogObject[], cfg: CategoryDef): CatalogObject[] {
  const cats = all.filter((o) => o.type === "CATEGORY");
  const items = all.filter((o) => o.type === "ITEM");
  const cat = cats.find(
    (c) => typeof c.categoryData?.name === "string" && cfg.match.test(c.categoryData!.name!),
  );
  const catId = cat?.id;
  return items.filter((it) => {
    const d = it.itemData;
    if (!d) return false;
    if (catId) {
      if (d.categoryId === catId) return true;
      if (Array.isArray(d.categories) && d.categories.some((c) => c.id === catId)) return true;
    }
    return cfg.match.test(d.name ?? "");
  });
}

type UpsertObject = Parameters<typeof squareClient.catalog.object.upsert>[0]["object"];

function withSoldOut(
  v: Variation,
  locationIds: string[],
  soldOut: boolean,
): Variation {
  const existing = v.itemVariationData?.locationOverrides ?? [];
  const byId = new Map<string, LocationOverride>();
  for (const o of existing) if (o.locationId) byId.set(o.locationId, { ...o });
  for (const id of locationIds) {
    const cur = byId.get(id) ?? { locationId: id };
    cur.soldOut = soldOut;
    byId.set(id, cur);
  }
  return {
    ...v,
    type: "ITEM_VARIATION",
    version: typeof v.version === "number" ? BigInt(v.version) : v.version,
    itemVariationData: {
      ...(v.itemVariationData ?? {}),
      locationOverrides: Array.from(byId.values()),
    },
  };
}

async function applyToCategory(
  cfg: CategoryDef,
  all: CatalogObject[],
  locationIds: string[],
  available: boolean,
): Promise<number> {
  const items = itemsInCategory(all, cfg);
  let updated = 0;
  for (const it of items) {
    if (!it.id) continue;
    const stamp = Date.now();

    // 1. Flip the Manage Inventory Status pill.
    //    Unavailable everywhere: present_at_all_locations=false +
    //    present_at_location_ids=[] (the item is present at no locations).
    //    Available everywhere: present_at_all_locations=true +
    //    present_at_location_ids=[] + absent_at_location_ids=[].
    //    Spread the existing item first, then overwrite the three flags
    //    explicitly so stale values from the catalog don't leak through.
    const nextItem = {
      ...(it as Record<string, unknown>),
      type: "ITEM",
      id: it.id,
      version: typeof it.version === "number" ? BigInt(it.version) : it.version,
      presentAtAllLocations: available,
      presentAtLocationIds: [],
      absentAtLocationIds: [],
    } as UpsertObject;
    await squareClient.catalog.object.upsert({
      idempotencyKey: `sold-out-item-${cfg.id}-${available ? "in" : "out"}-${it.id}-${stamp}`,
      object: nextItem,
    });
    updated += 1;

    // 2. Flip each variation's per-location soldOut override
    //    (drives the red Sold Out badge on POS + Online Ordering).
    const variations = it.itemData?.variations ?? [];
    for (const v of variations) {
      if (!v.id) continue;
      const nextVar = withSoldOut(v, locationIds, !available);
      await squareClient.catalog.object.upsert({
        idempotencyKey: `sold-out-var-${cfg.id}-${available ? "in" : "out"}-${v.id}-${stamp}`,
        object: nextVar as UpsertObject,
      });
      updated += 1;
    }
  }
  return updated;
}

export async function setCategoryPresence(categoryId: string, available: boolean): Promise<number> {
  const cfg = SOLD_OUT_CATEGORIES.find((c) => c.id === categoryId);
  if (!cfg) throw new Error(`Unknown sold-out category: ${categoryId}`);
  const [all, locationIds] = await Promise.all([listAllCatalog(), listLocationIds()]);
  if (locationIds.length === 0) {
    throw new Error("No Square locations resolved — cannot toggle sold-out.");
  }
  return applyToCategory(cfg, all, locationIds, available);
}

export async function restoreAllCategories(): Promise<{ category: string; restored: number }[]> {
  const [all, locationIds] = await Promise.all([listAllCatalog(), listLocationIds()]);
  const result: { category: string; restored: number }[] = [];
  for (const cfg of SOLD_OUT_CATEGORIES) {
    const restored = await applyToCategory(cfg, all, locationIds, true);
    result.push({ category: cfg.id, restored });
  }
  return result;
}
