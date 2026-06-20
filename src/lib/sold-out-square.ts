/**
 * Shared helpers for syncing the Daily Sold Out state to Square.
 *
 * Strategy: flip the ITEM's location presence so the Square Dashboard
 * Manage Inventory pill shows Unavailable and POS + Online Ordering
 * hide the item. We deliberately do NOT touch each variation's
 * locationOverrides[].soldOut — when the parent item is removed from
 * a location, Square rejects variation overrides that still reference
 * that location ("ITEM_VARIATION is enabled at location X, but the
 * referenced object of type ITEM is not"), so the two signals are
 * mutually exclusive.
 */
import { squareClient } from "@/lib/square";

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

async function applyToCategory(
  cfg: CategoryDef,
  all: CatalogObject[],
  available: boolean,
): Promise<number> {
  const items = itemsInCategory(all, cfg);
  let updated = 0;
  for (const it of items) {
    if (!it.id) continue;
    // Unavailable everywhere: present_at_all_locations=false +
    // present_at_location_ids=[] (the item is present at no locations).
    // Available everywhere: present_at_all_locations=true +
    // both lists empty.
    // Spread the existing item first, then overwrite the three flags
    // explicitly so stale values from the catalog don't leak through.
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
      idempotencyKey: `sold-out-${cfg.id}-${available ? "in" : "out"}-${it.id}-${Date.now()}`,
      object: nextItem,
    });
    updated += 1;
  }
  return updated;
}

export async function setCategoryPresence(categoryId: string, available: boolean): Promise<number> {
  const cfg = SOLD_OUT_CATEGORIES.find((c) => c.id === categoryId);
  if (!cfg) throw new Error(`Unknown sold-out category: ${categoryId}`);
  const all = await listAllCatalog();
  return applyToCategory(cfg, all, available);
}

export async function restoreAllCategories(): Promise<{ category: string; restored: number }[]> {
  const all = await listAllCatalog();
  const result: { category: string; restored: number }[] = [];
  for (const cfg of SOLD_OUT_CATEGORIES) {
    const restored = await applyToCategory(cfg, all, true);
    result.push({ category: cfg.id, restored });
  }
  return result;
}
