import { NextResponse } from "next/server";
import { squareClient } from "@/lib/square";
import { SOLD_OUT_EXCLUDED_NAME } from "@/lib/sold-out-square";

/**
 * GET /api/menu/sold-out-categories
 *
 * Pulls the Square catalog and returns the four manageable sold-out
 * categories (Squid, Snapper, Trevally, Tuna). Each entry includes
 * its display name, sub name (where present), item count and the
 * affected item names so the Daily Sold Out page can render the
 * grouped list without hard-coding the menu.
 */

type CategoryConfig = {
  id: string;
  displayName: string;
  subName?: string;
  /** Lower-case keyword(s) we look for in the item / category name. */
  match: RegExp;
};

const CONFIG: CategoryConfig[] = [
  { id: "squid", displayName: "Squid", subName: "Ika", match: /\b(squid|ika)\b/i },
  { id: "snapper", displayName: "Snapper", match: /\bsnapper\b/i },
  { id: "trevally", displayName: "Trevally", match: /\btrevally\b/i },
  { id: "tuna", displayName: "Tuna", match: /\btuna\b/i },
];

type CatalogObject = {
  id?: string;
  type?: string;
  categoryData?: { name?: string };
  itemData?: {
    name?: string;
    categories?: { id?: string }[];
    categoryId?: string;
  };
};

export async function GET() {
  try {
    // Pull every ITEM + CATEGORY from the catalog (Square paginates
    // so we walk the cursor until the page iterator yields no more).
    const all: CatalogObject[] = [];
    const page = await squareClient.catalog.list({ types: "ITEM,CATEGORY" });
    for await (const obj of page) {
      all.push(obj as CatalogObject);
    }

    const categories = all.filter((o) => o.type === "CATEGORY");
    const items = all.filter((o) => o.type === "ITEM");

    const out = CONFIG.map((cfg) => {
      // Find the matching Square category (so we can map by ID for items).
      const cat = categories.find(
        (c) => typeof c.categoryData?.name === "string" && cfg.match.test(c.categoryData!.name!),
      );
      const catId = cat?.id;

      const affected = items
        .filter((it) => {
          const d = it.itemData;
          if (!d) return false;
          const itemName = d.name ?? "";
          // Skip items that the Daily Sold Out toggle isn't allowed to manage
          // (e.g. cooked tuna, katsu kushi).
          if (SOLD_OUT_EXCLUDED_NAME.test(itemName)) return false;
          if (catId) {
            // Match by Square category ID first (most accurate).
            if (d.categoryId === catId) return true;
            if (Array.isArray(d.categories) && d.categories.some((c) => c.id === catId)) {
              return true;
            }
          }
          // Fallback: name keyword match — picks up "Ika (Squid) Sushi" etc.
          return cfg.match.test(itemName);
        })
        .map((it) => it.itemData?.name ?? "")
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));

      // Square sometimes has the same dish twice with different casing
      // (e.g. "Ika (Squid) Sushi" and "IKA (Squid) Sushi"). Both still get
      // toggled sold-out, but show the user one row per dish.
      const seen = new Set<string>();
      const uniqueAffected: string[] = [];
      for (const n of affected) {
        const key = n.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        uniqueAffected.push(n);
      }

      return {
        categoryId: cfg.id,
        displayName: cfg.displayName,
        ...(cfg.subName ? { subName: cfg.subName } : {}),
        itemCount: uniqueAffected.length,
        resetRule: "Reset automatically at end of day",
        affectedItems: uniqueAffected,
      };
    });

    return NextResponse.json(
      { dailySoldOutCategories: out },
      // 5-minute browser cache so the page doesn't hammer Square on every
      // refresh; Square menu changes rarely.
      { headers: { "cache-control": "private, max-age=300" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load Square catalog.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
