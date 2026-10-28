"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { useBackTo } from "@/hooks/useBackTo";
import { orderListText, readCart, writeCart, type Cart, type CartLine } from "@/lib/cart";
import { isOwnerOrChef } from "@/lib/permissions";
import { formatPrice, formatUpdated } from "@/lib/price-list-search";
import styles from "./page.module.css";

type Group = { supplier: string; lines: { key: string; line: CartLine }[] };

/** Cents, so a column of prices adds up to what each of them says. */
const lineTotal = (l: CartLine) => (Math.round(l.price * 100) * l.qty) / 100;
const sum = (lines: { line: CartLine }[]) =>
  lines.reduce((total, { line }) => total + Math.round(lineTotal(line) * 100), 0) / 100;

/** How long "Copied" stays on a button before it goes back to "Copy". */
const COPIED_MS = 2000;

/**
 * Put text on the clipboard. The modern call needs a secure page and a
 * permission some browsers withhold; the old one (a hidden textarea, selected
 * and copied) works wherever a tap started it. Resolves false if both fail.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const box = document.createElement("textarea");
      box.value = text;
      box.setAttribute("readonly", "");
      box.className = styles.clipboardBox;
      document.body.appendChild(box);
      box.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(box);
      return ok;
    } catch {
      return false;
    }
  }
}

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

function CopyIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
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
  const [folded, setFolded] = useState<Set<string>>(new Set());
  /** The button just pressed whose copy worked, for its moment of "Copied". */
  const [copied, setCopied] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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
  }

  const toggleFolded = (name: string) =>
    setFolded((set) => {
      const next = new Set(set);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  if (authLoading || !allowed) return null;

  const today = formatUpdated(Date.now());
  const textFor = (gs: Group[]) => gs.map((g) => orderListText(g.supplier, g.lines.map((l) => l.line), today)).join("\n\n");

  async function copy(id: string, gs: Group[]) {
    setMessage(null);
    if (await copyText(textFor(gs))) {
      setCopied(id);
      window.setTimeout(() => setCopied((current) => (current === id ? null : current)), COPIED_MS);
    } else {
      setMessage("Could not copy. Long-press the list to copy it by hand.");
    }
  }

  /** The phone's own share sheet; on a browser without one, the list is copied instead. */
  async function share(id: string, gs: Group[]) {
    setMessage(null);
    const text = textFor(gs);
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: gs.length === 1 ? `Order – ${gs[0].supplier}` : "Order lists", text });
      } catch (err) {
        // Closing the share sheet is a choice, not a failure.
        if (!(err instanceof DOMException && err.name === "AbortError")) setMessage("Could not open sharing.");
      }
      return;
    }
    if (await copyText(text)) {
      setCopied(id);
      setMessage("Sharing is not available here, so the list was copied.");
      window.setTimeout(() => setCopied((current) => (current === id ? null : current)), COPIED_MS);
    } else {
      setMessage("Sharing is not available here, and the list could not be copied.");
    }
  }

  const itemCount = groups.reduce((n, g) => n + g.lines.length, 0);
  const total = groups.reduce((t, g) => t + Math.round(sum(g.lines) * 100), 0) / 100;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button type="button" className={styles.backBtn} aria-label="Back to Item Search" onClick={goBack}>
          <BackIcon />
        </button>
        <h1 className={styles.title}>Cart</h1>
        <p className={styles.subtitle}>Copy or share supplier order lists.</p>
      </header>

      {cart === null ? null : groups.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyText}>Your cart is empty.</p>
          <Link href="/operations/item-search" className={styles.browseLink}>
            Find items
          </Link>
        </div>
      ) : (
        <>
          <div className={styles.info}>
            <span className={styles.infoIcon}>
              <InfoIcon />
            </span>
            <p className={styles.infoText}>No order was sent. This creates a copyable list only.</p>
          </div>

          <ul className={styles.groups}>
            {groups.map((g) => {
              const isFolded = folded.has(g.supplier);
              const count = g.lines.length;
              return (
                <li key={g.supplier} className={styles.group}>
                  <div className={styles.groupHead}>
                    <div className={styles.groupName}>
                      <p className={styles.supplier}>{g.supplier}</p>
                      <p className={styles.count}>
                        {count} {count === 1 ? "item" : "items"}
                      </p>
                    </div>
                    <p className={styles.groupTotal}>{formatPrice(sum(g.lines))}</p>
                    <button
                      type="button"
                      className={`${styles.fold} ${isFolded ? styles.foldShut : ""}`}
                      aria-expanded={!isFolded}
                      aria-label={isFolded ? `Show ${g.supplier} items` : `Hide ${g.supplier} items`}
                      onClick={() => toggleFolded(g.supplier)}
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

                  <div className={styles.actions}>
                    <button type="button" className={styles.actionBtn} onClick={() => void copy(g.supplier, [g])}>
                      {copied === g.supplier ? <CheckIcon /> : <CopyIcon />}
                      {copied === g.supplier ? "Copied" : "Copy"}
                    </button>
                    <button type="button" className={styles.actionBtn} onClick={() => void share(g.supplier, [g])}>
                      <ShareIcon />
                      Share
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className={styles.bar}>
            {message && <p className={styles.message}>{message}</p>}
            <div className={styles.barRow}>
              <div className={styles.barSummary}>
                <p className={styles.barCount}>
                  {groups.length} {groups.length === 1 ? "supplier" : "suppliers"} {"·"} {itemCount}{" "}
                  {itemCount === 1 ? "item" : "items"}
                </p>
                <p className={styles.barTotal}>{formatPrice(total)}</p>
              </div>
              <button type="button" className={styles.barBtn} onClick={() => void copy("all", groups)}>
                {copied === "all" ? <CheckIcon /> : <CopyIcon />}
                {copied === "all" ? "Copied" : "Copy All"}
              </button>
              <button
                type="button"
                className={`${styles.barBtn} ${styles.barBtnPrimary}`}
                onClick={() => void share("all", groups)}
              >
                <ShareIcon />
                Share All
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
