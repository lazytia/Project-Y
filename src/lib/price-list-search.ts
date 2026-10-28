/**
 * Searching, sorting and showing the price list. Plain functions of the list,
 * so the page is left with only state and markup.
 */
import type { PriceItem } from "@/lib/price-list-parse";

export type PriceSort = "updated" | "name" | "price-asc" | "price-desc";

export const PRICE_SORT_LABELS: Record<PriceSort, string> = {
  updated: "Recently changed",
  name: "Name (A–Z)",
  "price-asc": "Price: low to high",
  "price-desc": "Price: high to low",
};

/**
 * The items that match what was typed, within one supplier or all of them.
 *
 * Every word typed has to be found, in the item's name or its supplier's, in
 * any order and any case — "prawn 16/20" finds "FZ PRAWN - RAW CUTLET VANN
 * 16/20 700G" whichever way round it was typed.
 */
export function filterItems(items: PriceItem[], query: string, supplier: string): PriceItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((it) => {
    if (supplier && it.supplier !== supplier) return false;
    if (words.length === 0) return true;
    const haystack = `${it.name} ${it.supplier}`.toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}

const byName = (a: PriceItem, b: PriceItem) =>
  a.name.localeCompare(b.name, "en", { sensitivity: "base", numeric: true });
export function sortItems(items: PriceItem[], sort: PriceSort): PriceItem[] {
  const out = [...items];
  switch (sort) {
    case "updated":
      // Newest change first; what nothing dates goes last, in name order.
      return out.sort((a, b) => (b.updatedAt ?? -Infinity) - (a.updatedAt ?? -Infinity) || byName(a, b));
    case "price-asc":
      return out.sort((a, b) => a.price - b.price || byName(a, b));
    case "price-desc":
      return out.sort((a, b) => b.price - a.price || byName(a, b));
    default:
      return out.sort(byName);
  }
}

const money = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatPrice(n: number): string {
  return money.format(n);
}

/** "15 Oct 2026", in the restaurant's time zone. Empty when there is no date. */
export function formatUpdated(ms: number | null): string {
  if (ms === null) return "";
  return new Date(ms).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Australia/Sydney",
  });
}
