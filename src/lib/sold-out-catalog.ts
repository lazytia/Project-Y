import { squareClient } from "@/lib/square";
import { SOLD_OUT_EXCLUDED_NAME } from "@/lib/sold-out-square";

export type SoldOutCategoryPayload = {
  categoryId: string;
  displayName: string;
  subName?: string;
  itemCount: number;
  resetRule: string;
  affectedItems: string[];
};

type CategoryConfig = {
  id: string;
  displayName: string;
  subName?: string;
  match: RegExp;
};

const CONFIG: CategoryConfig[] = [
  { id: "snapper", displayName: "Snapper", match: /\bsnapper\b/i },
  { id: "trevally", displayName: "Trevally", match: /\btrevally\b/i },
  { id: "tuna", displayName: "Tuna", match: /\btuna\b/i },
  {
    id: "salmon-belly",
    displayName: "Salmon Belly",
    subName: "Salmon Belly Sushi, Salmon Belly Aburi",
    match: /\bsalmon\s+belly\b/i,
  },
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

export function buildSoldOutCategories(all: CatalogObject[]): SoldOutCategoryPayload[] {
  const categories = all.filter((o) => o.type === "CATEGORY");
  const items = all.filter((o) => o.type === "ITEM");

  return CONFIG.map((cfg) => {
    const cat = categories.find(
      (c) => typeof c.categoryData?.name === "string" && cfg.match.test(c.categoryData!.name!),
    );
    const catId = cat?.id;

    const affected = items
      .filter((it) => {
        const d = it.itemData;
        if (!d) return false;
        const itemName = d.name ?? "";
        if (SOLD_OUT_EXCLUDED_NAME.test(itemName)) return false;
        if (catId) {
          if (d.categoryId === catId) return true;
          if (Array.isArray(d.categories) && d.categories.some((c) => c.id === catId)) {
            return true;
          }
        }
        return cfg.match.test(itemName);
      })
      .map((it) => it.itemData?.name ?? "")
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

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
}

/** Walk the full Square ITEM + CATEGORY catalog (paginated). */
export async function fetchSquareCatalogObjects(): Promise<CatalogObject[]> {
  const all: CatalogObject[] = [];
  const page = await squareClient.catalog.list({ types: "ITEM,CATEGORY" });
  for await (const obj of page) {
    all.push(obj as CatalogObject);
  }
  return all;
}

export async function fetchSoldOutCategoriesFromSquare(): Promise<SoldOutCategoryPayload[]> {
  const all = await fetchSquareCatalogObjects();
  return buildSoldOutCategories(all);
}
