/**
 * How a day's sales divide between cash, card and everything else.
 *
 * Square records how each order was paid as `tenders` on the order, so the split
 * comes from the same orders the dashboard already fetches for its sales figure
 * — no second request.
 *
 * What is split is the sales figure itself (gross, 9am-10pm, refunds taken off),
 * not the money in the till. Tenders carry tax, tips and surcharges that the
 * sales figure leaves out, so adding up the tenders would not give the number
 * printed above them. Instead each order's gross sales are shared out across
 * the tenders that paid for it, and the result is scaled to the day's total.
 * Cash plus card plus other therefore always equals Total Sales, to the cent.
 */

export type PaymentSplitEntry = {
  /** Dollars. */
  amount: number;
  /** Percent of the day's sales, to one decimal. */
  pct: number;
};

export type PaymentSplit = {
  cash: PaymentSplitEntry;
  card: PaymentSplitEntry;
  /** Gift cards, wallets, bank transfers, "other" tenders — anything not cash or card. */
  other: PaymentSplitEntry;
};

type Money = { amount?: number | bigint | null } | null | undefined;

/** The part of a Square order this needs; the SDK's Order satisfies it. */
export type OrderForSplit = {
  tenders?:
    | { type?: string | null; amountMoney?: Money; tipMoney?: Money }[]
    | null;
};

type Bucket = "cash" | "card" | "other";

function bucketOf(type: string | null | undefined): Bucket {
  switch (type) {
    case "CASH":
      return "cash";
    // A card taken on another processor is still a card to whoever is reading.
    case "CARD":
    case "THIRD_PARTY_CARD":
      return "card";
    default:
      return "other";
  }
}

function cents(m: Money): number {
  return Number(m?.amount ?? 0);
}

/**
 * Split `total` (a whole number of units) in proportion to `weights`, so the
 * parts add up to exactly `total`. Largest remainder: round every share down,
 * then hand the leftover units to the shares that lost the most.
 */
export function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (!(sum > 0) || !(total > 0)) return weights.map(() => 0);
  const exact = weights.map((w) => (w / sum) * total);
  const parts = exact.map(Math.floor);
  let left = total - parts.reduce((s, n) => s + n, 0);
  const byRemainder = exact
    .map((e, i) => ({ i, rest: e - parts[i] }))
    .sort((a, b) => b.rest - a.rest);
  for (let k = 0; left > 0 && k < byRemainder.length; k += 1, left -= 1) {
    parts[byRemainder[k].i] += 1;
  }
  return parts;
}

/**
 * @param orders      the orders whose gross sales make up `totalDollars`
 * @param grossCents  an order's gross sales, in cents
 * @param totalDollars the day's sales as shown on the dashboard (refunds off)
 * @returns null when there is nothing to split: no paid orders yet, or no sales.
 */
export function splitSalesByTender<O extends OrderForSplit>(
  orders: O[],
  grossCents: (order: O) => number,
  totalDollars: number,
): PaymentSplit | null {
  const share: Record<Bucket, number> = { cash: 0, card: 0, other: 0 };

  for (const order of orders) {
    const gross = grossCents(order);
    if (!(gross > 0)) continue;

    // What each tender paid toward the order, tip left out — a tip is the
    // customer's to give and not part of the sale, and on a card it would tilt
    // the split towards card.
    const paid: Record<Bucket, number> = { cash: 0, card: 0, other: 0 };
    let paidTotal = 0;
    for (const tender of order.tenders ?? []) {
      const net = Math.max(0, cents(tender.amountMoney) - cents(tender.tipMoney));
      if (net <= 0) continue;
      paid[bucketOf(tender.type)] += net;
      paidTotal += net;
    }
    // An open order has no tender yet: it is in the sales figure but has no
    // payment method to count under, so it is left out of the proportions.
    if (paidTotal <= 0) continue;

    for (const bucket of ["cash", "card", "other"] as const) {
      share[bucket] += (gross * paid[bucket]) / paidTotal;
    }
  }

  const weights = [share.cash, share.card, share.other];
  if (!(weights.reduce((s, w) => s + w, 0) > 0)) return null;

  const totalCents = Math.round(totalDollars * 100);
  if (!(totalCents > 0)) return null;

  const amounts = apportion(totalCents, weights);
  // Tenths of a percent, so the three figures read as exactly 100.0.
  const pcts = apportion(1000, weights);

  return {
    cash: { amount: amounts[0] / 100, pct: pcts[0] / 10 },
    card: { amount: amounts[1] / 100, pct: pcts[1] / 10 },
    other: { amount: amounts[2] / 100, pct: pcts[2] / 10 },
  };
}
