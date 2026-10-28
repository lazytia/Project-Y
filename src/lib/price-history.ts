/**
 * When each price last changed, and what it was before.
 *
 * The sheet holds prices and not their history: a price edited in a tab simply
 * becomes the new price. So this keeps its own record, one document in
 * Firestore holding, for every item, its price as last seen and the prices it
 * has had with the day each began. Each read of the sheet is compared with it,
 * and an item whose price has moved gets a new point stamped with the moment
 * it moved.
 *
 * The record was started from the ERP's edit log (to the end of May) and from
 * the sheet's own saved versions (Google keeps about one a week), which gave
 * the changes made since. A date taken from a saved version is the day of the
 * first version showing the new price, so it can be a few days after the edit;
 * changes seen from here on are dated by the sheet's last-modified time, which
 * is closer.
 *
 * Server only.
 */
import { adminDb } from "@/lib/firebase-admin";
import type { PriceItem, PriceList, PricePoint } from "@/lib/price-list-parse";

const COLLECTION = "price_history";
const DOC_ID = "state";

/** Prices are in cents at most; closer than this is the same price. */
const SAME_PRICE = 0.005;

/** Points kept per item. A price that has moved this often is a story already told. */
const MAX_POINTS = 60;

type Entry = {
  /** The price as last seen. */
  p: number;
  /** When it last changed. Null when the item has not been seen to change. */
  at: number | null;
  /** The price before that change. */
  prev: number | null;
  /**
   * Every price the item has had, with the moment each began, oldest first.
   * Objects, not [at, price] pairs: Firestore does not take an array in an array.
   */
  h: PricePoint[];
};

type State = { prices: Record<string, Entry>; updatedAt: number };

/** The stored prices, or null when no record has been started yet. */
export type StoredPrices = Record<string, Entry> | null;

const keyOf = (it: PriceItem) => `${it.supplier.toLowerCase()}::${it.name.toLowerCase()}`;

/**
 * Read the record. Throws when Firestore cannot be reached: "no record" and
 * "could not look" must stay apart, or a failed read would be taken for an empty
 * one and the record started over on top of the real thing.
 *
 * A function of its own so a caller can start it alongside the sheet read
 * instead of after it.
 */
export async function loadPriceHistory(): Promise<StoredPrices> {
  const snap = await adminDb().collection(COLLECTION).doc(DOC_ID).get();
  return snap.exists ? ((snap.data() as State).prices ?? {}) : null;
}

/** Read the record, compare, update, and date the list by it. */
export async function withPriceHistory(list: PriceList, changedAt: number): Promise<PriceList> {
  try {
    return applyPriceHistory(list, await loadPriceHistory(), changedAt);
  } catch (err) {
    console.error("[price-history] could not read the record:", err);
    return list;
  }
}

/**
 * Compare the list with the record, update the record, and date each item by it.
 *
 * `changedAt` is the time to put on a price found to have moved. A failure to
 * reach Firestore leaves the list as it was: dates and graphs are an extra, and
 * a price list that cannot show them is still a price list.
 */
export async function applyPriceHistory(
  list: PriceList,
  stored: StoredPrices,
  changedAt: number,
): Promise<PriceList> {
  try {
    const ref = adminDb().collection(COLLECTION).doc(DOC_ID);

    const next: Record<string, Entry> = {};
    let dirty = stored === null;
    for (const it of list.items) {
      const key = keyOf(it);
      const old = stored?.[key];
      if (!old) {
        // First sight of the item. An item that turns up in an established
        // record is new to the sheet, not a price that changed.
        next[key] = {
          p: it.price,
          at: null,
          prev: null,
          h: [{ at: stored ? changedAt : (it.updatedAt ?? changedAt), p: it.price }],
        };
        if (stored) dirty = true;
      } else if (Math.abs(old.p - it.price) >= SAME_PRICE) {
        next[key] = {
          p: it.price,
          at: changedAt,
          prev: old.p,
          h: [...(old.h ?? []), { at: changedAt, p: it.price }].slice(-MAX_POINTS),
        };
        dirty = true;
      } else {
        next[key] = old;
      }
    }
    // Items gone from the sheet drop out of the record.
    if (stored && Object.keys(stored).some((key) => !(key in next))) dirty = true;

    if (dirty) await ref.set({ prices: next, updatedAt: Date.now() } satisfies State);

    return {
      ...list,
      items: list.items.map((it) => {
        const entry = next[keyOf(it)];
        const at = entry?.at ?? null;
        // A date the sheet itself carries can be the later of the two.
        const updatedAt = at === null ? it.updatedAt : Math.max(at, it.updatedAt ?? 0);
        // One point is no graph; leave it off rather than send every item's.
        const history: PricePoint[] = entry && entry.h.length >= 2 ? entry.h : [];
        return { ...it, updatedAt, history };
      }),
    };
  } catch (err) {
    console.error("[price-history] could not read or update the record:", err);
    return list;
  }
}
