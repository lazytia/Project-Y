const CACHE_KEY = "y.soldOutMenu.v4";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type SoldOutMenuCategory = {
  id: string;
  name: string;
  subName?: string;
  items: string[];
  icon: "squid" | "fish";
};

type CacheEntry = {
  categories: SoldOutMenuCategory[];
  savedAt: number;
};

export function readSoldOutMenuCache(): SoldOutMenuCategory[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!Array.isArray(parsed.categories)) return null;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) return null;
    return parsed.categories;
  } catch {
    return null;
  }
}

export function writeSoldOutMenuCache(categories: SoldOutMenuCategory[]) {
  if (typeof window === "undefined") return;
  try {
    const entry: CacheEntry = { categories, savedAt: Date.now() };
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    /* quota / private mode */
  }
}
