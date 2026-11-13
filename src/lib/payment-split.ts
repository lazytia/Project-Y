/**
 * What has been collected so far, by how it was paid: cash, card and everything else.
 *
 * Square records how each order was paid as `tenders` on the order, so the figures
 * come from the same orders the dashboard already fetches for its sales figure —
 * no second request.
 *
 * These are the amounts actually taken, the same ones Square's own Sales Report
 * prints under "Sales by payment types". They are NOT a cut of Total Sales: a table
 * that has eaten but not paid yet is in the sales figure and in no tender, so during
 * service cash plus card is less than the total, and catches up as tables settle.
 * Scaling them up to the total to hide that gap would show a cash figure the till
 * never held. The gap is reported as `unpaid` instead, so the three figures can be
 * read side by side.
 *
 * The other way round, a tender carries any tip on it and Total Sales does not, so
 * once everyone has paid, card can sit a few dollars above the total. That is
 * reported as `tips`, for the same reason.
 */

export type PaymentSplitEntry = {
  /** Dollars. */
  amount: number;
  /** Percent of what has been collected, to one decimal. */
  pct: number;
};

export type PaymentSplit = {
  cash: PaymentSplitEntry;
  card: PaymentSplitEntry;
  /** Gift cards, wallets, bank transfers, "other" tenders — anything not cash or card. */
  other: PaymentSplitEntry;
  /** Dollars of sales on open orders that have not been paid at all yet. */
  unpaid: number;
  /** Dollars of tips inside the amounts above — collected, but not sales. */
  tips: number;
};

type Money = { amount?: number | bigint | null } | null | undefined;

/** The part of a Square order this needs; the SDK's Order satisfies it. */
export type OrderForSplit = {
  state?: string | null;
  tenders?: { type?: string | null; amountMoney?: Money; tipMoney?: Money }[] | null;
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
 * @param orders     the orders whose payments to add up
 * @param grossCents an order's gross sales, in cents — what Total Sales is made of
 * @returns null when nothing has been paid and nothing is waiting to be.
 */
export function collectedByTender<O extends OrderForSplit>(
  orders: O[],
  grossCents: (order: O) => number,
): PaymentSplit | null {
  const collected: Record<Bucket, number> = { cash: 0, card: 0, other: 0 };
  let unpaid = 0;
  let tips = 0;

  for (const order of orders) {
    let tendered = 0;
    // A tender's amount includes any tip on it, as in Square's report.
    for (const tender of order.tenders ?? []) {
      const amount = cents(tender.amountMoney);
      if (amount <= 0) continue;
      collected[bucketOf(tender.type)] += amount;
      tendered += amount;
      tips += Math.min(amount, Math.max(0, cents(tender.tipMoney)));
    }
    // Waiting to be paid: open and no money taken yet. A completed order with
    // no tender is a comp, not a table still to settle, and one that has a
    // payment in progress is already counted above.
    if (order.state === "OPEN" && tendered === 0) unpaid += Math.max(0, grossCents(order));
  }

  const weights = [collected.cash, collected.card, collected.other];
  if (!(weights.reduce((s, w) => s + w, 0) > 0) && !(unpaid > 0)) return null;

  // Tenths of a percent, so the three figures read as exactly 100.0.
  const pcts = apportion(1000, weights);

  return {
    cash: { amount: collected.cash / 100, pct: pcts[0] / 10 },
    card: { amount: collected.card / 100, pct: pcts[1] / 10 },
    other: { amount: collected.other / 100, pct: pcts[2] / 10 },
    unpaid: unpaid / 100,
    tips: tips / 100,
  };
}
