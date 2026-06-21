/**
 * Shared helpers for syncing the Daily Sold Out state to Square.
 *
 * Strategy: Square's "Sold out" state (the Manage Inventory "Status" pill,
 * the POS sold-out badge, and the Online Ordering "unavailable" flag) is a
 * COMPUTED, read-only field on each ITEM_VARIATION location override. You
 * cannot set `soldOut` directly — Square derives it as
 *   soldOut = (trackInventory === true && availableQuantity <= 0)
 *
 * So to mark a category sold out we, per active location:
 *   1. keep the ITEM present (so the variation override is legal), and
 *   2. set the variation's locationOverride.trackInventory = true, and
 *   3. push the physical inventory count to 0 (best-effort safety net so the
 *      item is sold out even if it currently has positive stock).
 *
 * To restore, we set trackInventory = false, which makes Square treat the
 * item as always available regardless of the (irrelevant) stock count.
 *
 * NOTE: We deliberately do NOT flip presentAtAllLocations to hide the item.
 * Removing location presence makes the item vanish entirely but leaves the
 * Manage Inventory pill reading "Available", which is not what the owner
 * sees/expects. The trackInventory approach is the same one the Square POS
 * "Mark as sold out" button uses.
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

/**
 * Item names that the regex above would otherwise match but should NEVER be
 * managed by the Daily Sold Out toggle (different supply chain — cooked tuna
 * uses pantry tins, katsu kushi uses pre-portioned breaded fish).
 */
export const SOLD_OUT_EXCLUDED_NAME = /cooked\s+tuna|katsu\s+kushi/i;

type Variation = {
  id?: string;
  type?: string;
  version?: number | bigint;
  presentAtAllLocations?: boolean;
  itemVariationData?: {
    name?: string;
    itemId?: string;
    locationOverrides?: Array<{ locationId?: string; [k: string]: unknown }>;
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

// Cache the active location IDs for the lifetime of the module instance.
let cachedActiveLocationIds: string[] | null = null;
async function getActiveLocationIds(): Promise<string[]> {
  if (cachedActiveLocationIds) return cachedActiveLocationIds;
  const resp = await squareClient.locations.list();
  const ids = (resp.locations ?? [])
    .filter((l) => l.status === "ACTIVE" && typeof l.id === "string")
    .map((l) => l.id as string);
  cachedActiveLocationIds = ids;
  return ids;
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
    const name = d.name ?? "";
    if (SOLD_OUT_EXCLUDED_NAME.test(name)) return false;
    if (catId) {
      if (d.categoryId === catId) return true;
      if (Array.isArray(d.categories) && d.categories.some((c) => c.id === catId)) return true;
    }
    return cfg.match.test(name);
  });
}

type UpsertObject = Parameters<typeof squareClient.catalog.object.upsert>[0]["object"];

/**
 * Force the available stock of a variation to 0 at every active location so
 * that (with trackInventory on) Square computes soldOut = true. Best-effort:
 * a failure here must not abort the sold-out flip, because the catalog-level
 * trackInventory change already sells out items that sit at qty 0.
 */
async function zeroInventory(variationIds: string[], locationIds: string[]): Promise<void> {
  if (variationIds.length === 0 || locationIds.length === 0) return;
  const occurredAt = new Date().toISOString();
  const changes = [];
  for (const catalogObjectId of variationIds) {
    for (const locationId of locationIds) {
      changes.push({
        type: "PHYSICAL_COUNT" as const,
        physicalCount: {
          catalogObjectId,
          locationId,
          state: "IN_STOCK" as const,
          quantity: "0",
          occurredAt,
        },
      });
    }
  }
  try {
    await squareClient.inventory.batchCreateChanges({
      idempotencyKey: `sold-out-zero-${Date.now()}`,
      changes,
    });
  } catch (err) {
    console.error("[sold-out] zeroInventory failed (non-fatal):", err);
  }
}

async function applyToCategory(
  cfg: CategoryDef,
  all: CatalogObject[],
  available: boolean,
  activeLocationIds: string[],
): Promise<number> {
  const items = itemsInCategory(all, cfg).filter((it) => !!it.id);
  const soldOutVariationIds: string[] = [];

  const overrides = activeLocationIds.map((locationId) => ({
    locationId,
    trackInventory: !available,
  }));

  // Fan out the catalog upserts in parallel — Square processes each one
  // independently and the network round-trip dominates each call, so a
  // 6-item category drops from ~4s sequential to ~700ms parallel.
  const upserts = items.map((it) => {
    const variations = (it.itemData?.variations ?? []).map((v) => {
      if (!available && v.id) soldOutVariationIds.push(v.id);
      return {
        ...(v as Record<string, unknown>),
        type: "ITEM_VARIATION",
        id: v.id,
        version: typeof v.version === "number" ? BigInt(v.version) : v.version,
        presentAtAllLocations: true,
        presentAtLocationIds: [],
        absentAtLocationIds: [],
        itemVariationData: {
          ...(v.itemVariationData ?? {}),
          locationOverrides: overrides,
        },
      };
    });

    const nextItem = {
      ...(it as Record<string, unknown>),
      type: "ITEM",
      id: it.id,
      version: typeof it.version === "number" ? BigInt(it.version) : it.version,
      presentAtAllLocations: true,
      presentAtLocationIds: [],
      absentAtLocationIds: [],
      itemData: { ...(it.itemData ?? {}), variations },
    } as UpsertObject;

    return squareClient.catalog.object.upsert({
      idempotencyKey: `sold-out-${cfg.id}-${available ? "in" : "out"}-${it.id}-${Date.now()}`,
      object: nextItem,
    });
  });

  await Promise.all(upserts);
  if (!available) {
    await zeroInventory(soldOutVariationIds, activeLocationIds);
  }
  return items.length;
}

export async function setCategoryPresence(categoryId: string, available: boolean): Promise<number> {
  const cfg = SOLD_OUT_CATEGORIES.find((c) => c.id === categoryId);
  if (!cfg) throw new Error(`Unknown sold-out category: ${categoryId}`);
  const [all, activeLocationIds] = await Promise.all([listAllCatalog(), getActiveLocationIds()]);
  return applyToCategory(cfg, all, available, activeLocationIds);
}

export async function restoreAllCategories(): Promise<{ category: string; restored: number }[]> {
  const [all, activeLocationIds] = await Promise.all([listAllCatalog(), getActiveLocationIds()]);
  const result: { category: string; restored: number }[] = [];
  for (const cfg of SOLD_OUT_CATEGORIES) {
    const restored = await applyToCategory(cfg, all, true, activeLocationIds);
    result.push({ category: cfg.id, restored });
  }
  return result;
}
