/**
 * Shared helpers for syncing the Daily Sold Out state to Square.
 *
 * Strategy: flip every affected item's `presentAtAllLocations` flag.
 * When `false`, the item disappears from POS and Online Ordering until
 * we flip it back. No inventory tracking required.
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

/** Pull every ITEM + CATEGORY from the Square catalog. */
async function listAllCatalog(): Promise<CatalogObject[]> {
  const out: CatalogObject[] = [];
  const page = await squareClient.catalog.list({ types: "ITEM,CATEGORY" });
  for await (const obj of page) {
    out.push(obj as CatalogObject);
  }
  return out;
}

/** Items belonging to a single category (by Square ID, or name fallback). */
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

/**
 * Toggle `presentAtAllLocations` for every item in one of our managed
 * categories. Returns the number of catalog rows updated.
 */
export async function setCategoryPresence(categoryId: string, available: boolean): Promise<number> {
  const cfg = SOLD_OUT_CATEGORIES.find((c) => c.id === categoryId);
  if (!cfg) throw new Error(`Unknown sold-out category: ${categoryId}`);
  const all = await listAllCatalog();
  const items = itemsInCategory(all, cfg);
  let updated = 0;
  for (const it of items) {
    if (!it.id) continue;
    if (it.presentAtAllLocations === available) continue; // already in target state
    const idempotencyKey = `sold-out-${categoryId}-${available ? "in" : "out"}-${it.id}-${Date.now()}`;
    await squareClient.catalog.object.upsert({
      idempotencyKey,
      object: {
        ...(it as Record<string, unknown>),
        type: "ITEM",
        id: it.id,
        version: typeof it.version === "number" ? BigInt(it.version) : it.version,
        presentAtAllLocations: available,
      } as Parameters<typeof squareClient.catalog.object.upsert>[0]["object"],
    });
    updated += 1;
  }
  return updated;
}

/**
 * Restore EVERY item in every managed category to
 * presentAtAllLocations = true (used by the daily 9 PM reset).
 */
export async function restoreAllCategories(): Promise<{ category: string; restored: number }[]> {
  const all = await listAllCatalog();
  const result: { category: string; restored: number }[] = [];
  for (const cfg of SOLD_OUT_CATEGORIES) {
    const items = itemsInCategory(all, cfg);
    let restored = 0;
    for (const it of items) {
      if (!it.id) continue;
      if (it.presentAtAllLocations === true) continue;
      const idempotencyKey = `reset-${cfg.id}-${it.id}-${new Date().toISOString().slice(0, 10)}`;
      await squareClient.catalog.object.upsert({
        idempotencyKey,
        object: {
          ...(it as Record<string, unknown>),
          type: "ITEM",
          id: it.id,
          version: typeof it.version === "number" ? BigInt(it.version) : it.version,
          presentAtAllLocations: true,
        } as Parameters<typeof squareClient.catalog.object.upsert>[0]["object"],
      });
      restored += 1;
    }
    result.push({ category: cfg.id, restored });
  }
  return result;
}
