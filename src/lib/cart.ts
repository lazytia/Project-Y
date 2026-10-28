/**
 * The order being put together from Item Search.
 *
 * Kept on the device, per signed-in person, so the quantities set on one screen
 * are still there on the cart page and when the app is reopened. Each line
 * carries what it was when it was added (name, unit, price), so the cart page
 * does not have to fetch the price list again to say what is in it.
 */

export type CartLine = {
  supplier: string;
  name: string;
  unit: string;
  price: number;
  qty: number;
};

/** Item key → line. A line is dropped when its quantity goes back to zero. */
export type Cart = Record<string, CartLine>;

export const cartKeyOf = (it: { supplier: string; name: string }) => `${it.supplier}::${it.name}`;

const storageKey = (uid: string) => `y.cart.v1.${uid}`;

function isLine(v: unknown): v is CartLine {
  const l = v as CartLine;
  return (
    !!l &&
    typeof l.supplier === "string" &&
    typeof l.name === "string" &&
    typeof l.unit === "string" &&
    typeof l.price === "number" &&
    Number.isInteger(l.qty) &&
    l.qty > 0
  );
}

/** The saved cart. Empty when nothing is saved, or storage is unavailable or garbled. */
export function readCart(uid: string): Cart {
  try {
    const raw = window.localStorage.getItem(storageKey(uid));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const cart: Cart = {};
    for (const [key, line] of Object.entries(parsed)) if (isLine(line)) cart[key] = line;
    return cart;
  } catch {
    return {};
  }
}

export function writeCart(uid: string, cart: Cart): void {
  try {
    window.localStorage.setItem(storageKey(uid), JSON.stringify(cart));
  } catch {
    // Private mode or a full disk: the cart still works for this visit.
  }
}

/** How many of everything: what the cart icon's badge shows. */
export function cartCount(cart: Cart): number {
  return Object.values(cart).reduce((sum, line) => sum + line.qty, 0);
}
