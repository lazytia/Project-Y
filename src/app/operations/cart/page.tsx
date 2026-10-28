"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { useBackTo } from "@/hooks/useBackTo";
import { readCart, writeCart, type Cart, type CartLine } from "@/lib/cart";
import { isOwnerOrChef } from "@/lib/permissions";
import { formatPrice } from "@/lib/price-list-search";
import styles from "./page.module.css";

type Group = { supplier: string; lines: { key: string; line: CartLine }[] };

/** Cents, so a column of prices adds up to what each of them says. */
const lineTotal = (l: CartLine) => (Math.round(l.price * 100) * l.qty) / 100;
const sum = (lines: { line: CartLine }[]) =>
  lines.reduce((total, { line }) => total + Math.round(lineTotal(line) * 100), 0) / 100;

function BackIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 15 12 9 18 15" />
    </svg>
  );
}

export default function CartPage() {
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwnerOrChef(user);
  // The cart is reached from Item Search and is a step on from it.
  const goBack = useBackTo("/operations/item-search");

  /** Null until the device's cart has been read. */
  const [cart, setCart] = useState<Cart | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (user) setCart(readCart(user.uid));
  }, [user]);

  const groups: Group[] = useMemo(() => {
    const bySupplier = new Map<string, Group>();
    for (const [key, line] of Object.entries(cart ?? {})) {
      const group = bySupplier.get(line.supplier) ?? { supplier: line.supplier, lines: [] };
      group.lines.push({ key, line });
      bySupplier.set(line.supplier, group);
    }
    const out = [...bySupplier.values()].sort((a, b) => a.supplier.localeCompare(b.supplier, "en"));
    for (const g of out) g.lines.sort((a, b) => a.line.name.localeCompare(b.line.name, "en", { numeric: true }));
    return out;
  }, [cart]);

  function change(next: Cart) {
    setCart(next);
    if (user) writeCart(user.uid, next);
  }

  function setQty(key: string, qty: number) {
    if (!cart?.[key] || qty < 1) return;
    change({ ...cart, [key]: { ...cart[key], qty } });
  }

  function remove(key: string) {
    if (!cart) return;
    const next = { ...cart };
    delete next[key];
    change(next);
    // A supplier with nothing left in the cart has nothing to order.
    const stillThere = new Set(Object.values(next).map((l) => l.supplier));
    setSelected((s) => new Set([...s].filter((name) => stillThere.has(name))));
  }

  const toggle = (set: Set<string>, name: string) => {
    const next = new Set(set);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    return next;
  };

  if (authLoading || !allowed) return null;

  const chosen = groups.filter((g) => selected.has(g.supplier));
  const chosenTotal = chosen.reduce((total, g) => total + Math.round(sum(g.lines) * 100), 0) / 100;
  const placeLabel =
    chosen.length === 0 ? "Place Order" : chosen.length === 1 ? `Place Order (${chosen[0].supplier})` : `Place Orders (${chosen.length})`;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button type="button" className={styles.backBtn} aria-label="Back to Item Search" onClick={goBack}>
          <BackIcon />
        </button>
        <h1 className={styles.title}>Cart</h1>
        <p className={styles.subtitle}>Review and place orders by supplier.</p>
      </header>

      {cart === null ? null : groups.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyText}>Your cart is empty.</p>
          <Link href="/operations/item-search" className={styles.browseLink}>
            Find items
          </Link>
        </div>
      ) : (
        <ul className={styles.groups}>
          {groups.map((g) => {
            const isFolded = folded.has(g.supplier);
            const itemCount = g.lines.length;
            return (
              <li key={g.supplier} className={styles.group}>
                <div className={styles.groupHead}>
                  <input
                    type="checkbox"
                    className={styles.check}
                    checked={selected.has(g.supplier)}
                    onChange={() => setSelected((s) => toggle(s, g.supplier))}
                    aria-label={`Select ${g.supplier}`}
                  />
                  <div className={styles.groupName}>
                    <p className={styles.supplier}>{g.supplier}</p>
                    <p className={styles.count}>
                      {itemCount} {itemCount === 1 ? "item" : "items"}
                    </p>
                  </div>
                  <p className={styles.groupTotal}>{formatPrice(sum(g.lines))}</p>
                  <button
                    type="button"
                    className={`${styles.fold} ${isFolded ? styles.foldShut : ""}`}
                    aria-expanded={!isFolded}
                    aria-label={isFolded ? `Show ${g.supplier} items` : `Hide ${g.supplier} items`}
                    onClick={() => setFolded((f) => toggle(f, g.supplier))}
                  >
                    <ChevronIcon />
                  </button>
                </div>

                {!isFolded && (
                  <>
                    <ul className={styles.lines}>
                      {g.lines.map(({ key, line }) => (
                        <li key={key} className={styles.line}>
                          <p className={styles.lineName}>{line.name}</p>
                          <button
                            type="button"
                            className={styles.removeBtn}
                            aria-label={`Remove ${line.name}`}
                            onClick={() => remove(key)}
                          >
                            <CloseIcon />
                          </button>
                          <div className={styles.stepper}>
                            <button
                              type="button"
                              className={styles.stepBtn}
                              aria-label={`Remove one ${line.name}`}
                              disabled={line.qty <= 1}
                              onClick={() => setQty(key, line.qty - 1)}
                            >
                              <MinusIcon />
                            </button>
                            <span className={styles.qty}>{line.qty}</span>
                            <button
                              type="button"
                              className={styles.stepBtn}
                              aria-label={`Add one ${line.name}`}
                              onClick={() => setQty(key, line.qty + 1)}
                            >
                              <PlusIcon />
                            </button>
                          </div>
                          <p className={styles.unitPrice}>
                            {formatPrice(line.price)} / {line.unit}
                          </p>
                          <p className={styles.lineTotal}>{formatPrice(lineTotal(line))}</p>
                        </li>
                      ))}
                    </ul>
                    <div className={styles.subtotal}>
                      <span className={styles.subtotalLabel}>Subtotal</span>
                      <span className={styles.subtotalAmount}>{formatPrice(sum(g.lines))}</span>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {groups.length > 0 && (
        <div className={styles.bar}>
          {notice && <p className={styles.notice}>{notice}</p>}
          <div className={styles.barRow}>
            <div className={styles.barSummary}>
              <p className={styles.barCount}>
                {chosen.length === 0
                  ? "No supplier selected"
                  : `${chosen.length} ${chosen.length === 1 ? "supplier" : "suppliers"} selected`}
              </p>
              <p className={styles.barTotal}>{formatPrice(chosenTotal)}</p>
            </div>
            <button
              type="button"
              className={styles.placeBtn}
              disabled={chosen.length === 0}
              onClick={() => setNotice("Ordering is not connected yet, so nothing was sent.")}
            >
              {placeLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
