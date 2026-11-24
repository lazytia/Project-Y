/* ──────────────────────────────────────────────────────────────────────
 * How many of each dish went out in a week.
 *
 * The shape the API answers with and the page draws, plus the plain
 * functions both of them need. No imports and no network, so the grouping
 * and the labels can be checked on their own.
 * ──────────────────────────────────────────────────────────────────── */

export type DishGroup = "food" | "drinks";

export type DishSales = {
  /** The dish as the menu names it. */
  name: string;
  /** Square's category for it, kept so the page can say where a dish sits. */
  category: string;
  group: DishGroup;
  qty: number;
  previousQty: number;
  /** Change in count on last week, or null where the dish did not sell then. */
  deltaPct: number | null;
};

export type MenuWeek = {
  /** Monday and Sunday of the week this covers, and of the one before it. */
  weekStart: string;
  weekEnd: string;
  previousWeekStart: string;
  previousWeekEnd: string;
  /** Every dish counted, not only the ones drawn. */
  totalQty: number;
  previousTotalQty: number;
  totalDeltaPct: number | null;
  /** How many different dishes sold at all. */
  dishCount: number;
  /** Most sold first. */
  dishes: DishSales[];
};

/**
 * The Square categories that are a drink, lower-cased.
 *
 * Square has no flag for this and the menu has 113 categories, several of
 * them the same name under a different menu, so the split is by name. The
 * wine colours are categories of their own — a bottle of red is filed under
 * "Red", not under "Wine" — which is why they are listed here too.
 *
 * A new drink category is food until its name is added here. Worth knowing
 * when the bar list changes.
 */
const DRINK_CATEGORIES: ReadonlySet<string> = new Set([
  "beer",
  "beer cocktail",
  "champagne",
  "chu-hi & highball",
  "cocktail",
  "drink",
  "drinks",
  "highball",
  "liquor",
  "red",
  "rose",
  "rosé",
  "sake",
  "shochu",
  "soft drink",
  "sparkling",
  "spirits",
  "umeshu",
  "white",
  "whisky",
  "wine",
]);

/** Which half of the menu a category belongs to. Unknown counts as food. */
export function groupOfCategory(category: string): DishGroup {
  return DRINK_CATEGORIES.has(category.trim().toLowerCase()) ? "drinks" : "food";
}

export type DishFilter = "all" | DishGroup;

export const DISH_FILTER_LABELS: Record<DishFilter, string> = {
  all: "All",
  food: "Food",
  drinks: "Drinks",
};

/**
 * The dishes on one tab that match what was typed.
 *
 * Every word has to be found somewhere in the dish's name or its category, in
 * any order and any case — the same rule the price list searches by, so
 * "salmon don" finds "Teriyaki Salmon Donburi (A)".
 */
export function filterDishes(dishes: DishSales[], filter: DishFilter, query: string): DishSales[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return dishes.filter((d) => {
    if (filter !== "all" && d.group !== filter) return false;
    if (words.length === 0) return true;
    const haystack = `${d.name} ${d.category}`.toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOWS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parts(iso: string): { dow: string; day: number; month: string } {
  const [y, m, d] = iso.split("-").map(Number);
  return {
    dow: DOWS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()],
    day: d,
    month: MONTHS[m - 1],
  };
}

/** "Mon, 17 Nov – Sun, 23 Nov". */
export function weekRangeLabel(startISO: string, endISO: string): string {
  const a = parts(startISO);
  const b = parts(endISO);
  return `${a.dow}, ${a.day} ${a.month} – ${b.dow}, ${b.day} ${b.month}`;
}

/**
 * What to call the week above its dates: the two everybody means by name, and
 * the month for the rest. `thisMonday` is today's week, so the page says the
 * same thing the kitchen would.
 */
export function weekTitle(startISO: string, thisMonday: string): string {
  if (startISO === thisMonday) return "This Week";
  const [y, m, d] = thisMonday.split("-").map(Number);
  const lastMonday = new Date(Date.UTC(y, m - 1, d - 7)).toISOString().slice(0, 10);
  if (startISO === lastMonday) return "Last Week";
  const a = parts(startISO);
  return `Week of ${a.day} ${a.month}`;
}

/** "+12%", "−6%", or "—" where there is nothing to compare against. */
export function fmtDelta(pct: number | null): string {
  if (pct === null) return "—";
  const rounded = Math.round(pct);
  if (rounded === 0) return "0%";
  return rounded > 0 ? `+${rounded}%` : `−${Math.abs(rounded)}%`;
}

/** Percent change, or null when there is no earlier figure to measure from. */
export function deltaPct(now: number, before: number): number | null {
  if (before <= 0) return null;
  return Math.round(((now - before) / before) * 1000) / 10;
}
