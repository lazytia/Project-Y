/* ──────────────────────────────────────────────────────────────────────
 * The supplier price list, as the sheet holds it, turned into one flat list.
 *
 * The sheet is the kitchen's working price file: a tab per supplier, an
 * ITEM / UNIT / PRICE table on each. The tabs are the price list — what is
 * written there is what an item costs.
 *
 * A hidden `__overrides` tab is a log the ERP kept of its own edits, each with
 * the time it was made. It is not read for prices. The ERP is being retired,
 * its log stopped at the end of May, and the tabs have been edited by hand
 * since: of the items it logged, a quarter now carry a different price on
 * their tab, and the tab is the newer. Laid over the tabs, the log would put
 * May's price back on an item the day someone corrected it in the sheet. It
 * is used for one thing only — the date of a price, when the price on the tab
 * is the very one the log recorded.
 *
 * No imports and no network, so the parsing can be run against a copy of the
 * sheet.
 * ──────────────────────────────────────────────────────────────────── */

export type PriceItem = {
  supplier: string;
  name: string;
  /** Pack or measure the price is for; "unit" when the sheet does not say. */
  unit: string;
  price: number;
  /** Epoch ms the price last changed. Null where nothing dates it. */
  updatedAt: number | null;
  /**
   * The prices the item has had, oldest first, each from the moment it began.
   * Only present, and only with two or more points, where there is a change to
   * draw; filled in by lib/price-history, not by the sheet.
   */
  history?: PricePoint[];
};

export type PricePoint = { at: number; p: number };

export type PriceList = {
  /** Suppliers that have at least one item, in sheet order. */
  suppliers: string[];
  items: PriceItem[];
};

export type SheetTab = { title: string; rows: unknown[][] };

/** Where the ERP logged its edits. Not a supplier. */
export const OVERRIDES_TAB = "__overrides";

const ITEM_HEADERS = ["ITEM", "ITEM NAME", "PRODUCT", "DESCRIPTION"];
const UNIT_HEADERS = ["UNIT", "PACK", "SIZE", "UOM"];
const PRICE_HEADERS = ["PRICE", "UNIT PRICE", "COST"];
const DATE_HEADERS = ["DATE", "UPDATED", "UPDATED AT", "EFFECTIVE DATE", "LAST UPDATED"];

/** "13-06", "25-7", "01/08/26": the date columns of a price-history tab. */
const DATE_HEADER_RE = /^\d{1,2}[-/]\d{1,2}([-/]\d{2,4})?$/;

/** Prices are in cents of a dollar at most; closer than this is the same price. */
const SAME_PRICE = 0.005;

function text(v: unknown): string {
  return String(v ?? "").trim();
}

/** A price cell: a number, "$11.80", "1,200", or nothing. Zero when unreadable. */
function money(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = text(v);
  if (!s) return 0;
  const n = Number(s.replace(/[,$()\s]/g, "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * A date cell as epoch ms: "2026-05-23" or a full ISO timestamp.
 *
 * A bare date is put at midday UTC so it reads as the same calendar day in
 * Sydney, whichever side of midnight the offset would otherwise throw it.
 */
function dateMs(v: unknown): number | null {
  const s = text(v);
  if (!s) return null;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (day) return Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]), 12);
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function colOf(headers: string[], names: string[]): number {
  return headers.findIndex((h) => names.includes(h.toUpperCase()));
}

function headerRowOf(rows: unknown[][]): number {
  return rows.findIndex((row) => {
    const cells = (row ?? []).map(text);
    const upper = cells.map((c) => c.toUpperCase());
    return (
      ITEM_HEADERS.some((n) => upper.includes(n)) &&
      (PRICE_HEADERS.some((n) => upper.includes(n)) || cells.some((c) => DATE_HEADER_RE.test(c)))
    );
  });
}

type ParsedRow = Omit<PriceItem, "supplier">;

/** One supplier tab, or null when it has no recognisable header row. */
function parseTab(rows: unknown[][]): ParsedRow[] | null {
  const headerAt = headerRowOf(rows);
  if (headerAt < 0) return null;
  const headers = (rows[headerAt] ?? []).map(text);

  const itemCol = Math.max(0, colOf(headers, ITEM_HEADERS));
  const unitCol = colOf(headers, UNIT_HEADERS);
  const dateCol = colOf(headers, DATE_HEADERS);
  let priceCol = colOf(headers, PRICE_HEADERS);
  const isDateMatrix = headers.some((h) => DATE_HEADER_RE.test(h));
  // An ITEM / PRICE sheet with no header for the price: it is the second column.
  if (priceCol < 0 && headers.length > 1 && !isDateMatrix) priceCol = 1;

  const out: ParsedRow[] = [];
  for (const row of rows.slice(headerAt + 1)) {
    const cells = row ?? [];
    const name = text(cells[itemCol]);
    if (!name) continue;

    let price = priceCol >= 0 ? money(cells[priceCol]) : 0;
    if (priceCol < 0) {
      // A history tab with no Price column: the newest figure, which is the
      // rightmost one with anything in it.
      for (let c = cells.length - 1; c > itemCol; c -= 1) {
        if (DATE_HEADER_RE.test(headers[c] ?? "") && money(cells[c]) > 0) {
          price = money(cells[c]);
          break;
        }
      }
    }
    // A row with no price is a heading or a gap, not an item to quote.
    if (price <= 0) continue;

    out.push({
      name,
      unit: (unitCol >= 0 ? text(cells[unitCol]) : "") || "unit",
      price,
      updatedAt: dateCol >= 0 ? dateMs(cells[dateCol]) : null,
    });
  }
  return out;
}

/** Names are matched without regard to case. */
const keyOf = (supplier: string, name: string) => `${supplier.toLowerCase()}::${name.toLowerCase()}`;

/**
 * Newest logged price per (supplier, item), from the `__overrides` tab:
 * Supplier, Original Item, Item, Unit, Price, Updated At, Updated By.
 *
 * Filed under the item's name before and after a rename, so a price keeps its
 * date through one. A row whose Updated By starts "deleted:" is skipped.
 */
function loggedPrices(rows: unknown[][]): Map<string, { price: number; at: number }> {
  const entries: { supplier: string; names: string[]; price: number; at: number }[] = [];
  for (const row of rows.slice(1)) {
    const cells = row ?? [];
    const supplier = text(cells[0]);
    const item = text(cells[2]);
    const at = dateMs(cells[5]);
    if (!supplier || !item || at === null) continue;
    if (text(cells[6]).toLowerCase().startsWith("deleted:")) continue;
    const names = [item, text(cells[1])].filter(Boolean);
    entries.push({ supplier, names, price: money(cells[4]), at });
  }
  // Oldest first, so the last write for a name is the newest.
  entries.sort((a, b) => a.at - b.at);

  const out = new Map<string, { price: number; at: number }>();
  for (const e of entries) {
    for (const name of e.names) out.set(keyOf(e.supplier, name), { price: e.price, at: e.at });
  }
  return out;
}

export function buildPriceList(tabs: SheetTab[]): PriceList {
  const logged = loggedPrices(tabs.find((t) => t.title === OVERRIDES_TAB)?.rows ?? []);

  const suppliers: string[] = [];
  const items: PriceItem[] = [];

  for (const tab of tabs) {
    if (tab.title === OVERRIDES_TAB) continue;
    const parsed = parseTab(tab.rows);
    if (!parsed) continue;

    // A name listed twice on a tab keeps its last row, and its place in the list.
    const byName = new Map<string, PriceItem>();
    for (const p of parsed) {
      const key = keyOf(tab.title, p.name);
      // The tab's own date wins. Failing that, the log's, but only where the
      // log recorded this very price: a different price on the tab was set
      // later, by hand, and the log cannot say when. (lib/price-history dates
      // those from the sheet's saved versions.)
      const rec = logged.get(key);
      const updatedAt =
        p.updatedAt ?? (rec && Math.abs(rec.price - p.price) < SAME_PRICE ? rec.at : null);
      byName.set(key, { supplier: tab.title, ...p, updatedAt });
    }
    if (byName.size === 0) continue;
    suppliers.push(tab.title);
    items.push(...byName.values());
  }
  return { suppliers, items };
}
