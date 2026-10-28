"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { useBackToDashboard } from "@/hooks/useBackToDashboard";
import { cartCount, cartKeyOf, readCart, writeCart, type Cart } from "@/lib/cart";
import { isOwnerOrChef } from "@/lib/permissions";
import type { PriceItem, PriceList } from "@/lib/price-list-parse";
import {
  PRICE_SORT_LABELS,
  filterItems,
  formatPrice,
  formatUpdated,
  sortItems,
  type PriceSort,
} from "@/lib/price-list-search";
import PriceHistoryChart from "./PriceHistoryChart";
import styles from "./page.module.css";

/** Rows drawn at a time. The list is a few hundred long; a phone need not paint it all. */
const PAGE_SIZE = 50;

/** Give up on the read rather than leave the page on its loading line. */
const FETCH_TIMEOUT_MS = 20 * 1000;

const SORT_ORDER: PriceSort[] = ["updated", "name", "price-asc", "price-desc"];

/**
 * The last list received, kept on the device.
 *
 * Reading the sheet takes a moment, so the page shows what it saw last time the
 * instant it opens and swaps in the fresh list when that arrives. The list is
 * the same for everyone who may open this page, so it is not kept per person;
 * who may fetch a new one is still decided by the server.
 */
const LIST_CACHE_KEY = "y.priceList.v1";

function readListCache(): PriceList | null {
  try {
    const raw = window.localStorage.getItem(LIST_CACHE_KEY);
    const list = raw ? (JSON.parse(raw) as PriceList) : null;
    return list && Array.isArray(list.items) && Array.isArray(list.suppliers) ? list : null;
  } catch {
    return null;
  }
}

function writeListCache(list: PriceList): void {
  try {
    window.localStorage.setItem(LIST_CACHE_KEY, JSON.stringify(list));
  } catch {
    // Storage full or switched off: the page works the same, a little slower to open.
  }
}

function SearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="20" r="1.5" />
      <circle cx="18" cy="20" r="1.5" />
      <path d="M2 3h3l2.6 12.4a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L21 8H6" />
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

export default function ItemSearchPage() {
  const goBack = useBackToDashboard();
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwnerOrChef(user);

  const [list, setList] = useState<PriceList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [supplier, setSupplier] = useState("");
  // What the kitchen opens this for: which prices have moved.
  const [sort, setSort] = useState<PriceSort>("updated");
  const [shown, setShown] = useState(PAGE_SIZE);
  /** The card opened to show its price history. One at a time. */
  const [openKey, setOpenKey] = useState<string | null>(null);

  const [cart, setCart] = useState<Cart>({});

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/price-list", {
        headers: { Authorization: `Bearer ${idToken}` },
        signal: abort.signal,
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error ?? `Failed (${res.status}).`);
      setList(payload as PriceList);
      writeListCache(payload as PriceList);
    } catch (err) {
      const timedOut = err instanceof DOMException && err.name === "AbortError";
      setError(
        timedOut
          ? "The price list took too long to load."
          : err instanceof Error
            ? err.message
            : String(err),
      );
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading || !allowed) return;
    void load();
  }, [authLoading, allowed, load]);

  // Show the last list at once; the fetch above replaces it when it lands.
  useEffect(() => {
    const cached = readListCache();
    if (cached) {
      setList((current) => current ?? cached);
      setLoading(false);
    }
  }, []);

  // The cart is kept on the device; pick it up again when the page opens.
  useEffect(() => {
    if (user) setCart(readCart(user.uid));
  }, [user]);

  // A new search starts from the top of its results again.
  useEffect(() => {
    setShown(PAGE_SIZE);
    setOpenKey(null);
  }, [query, supplier, sort]);

  const trimmed = query.trim();
  const results = useMemo(
    () => (list ? sortItems(filterItems(list.items, query, supplier), sort) : []),
    [list, query, supplier, sort],
  );

  /**
   * Put one of the item in the cart. The screen stays where it is, so the next
   * item can be added straight away; the cart icon's count is what moves.
   */
  function addToCart(it: PriceItem) {
    if (!user) return;
    const key = cartKeyOf(it);
    const qty = (cart[key]?.qty ?? 0) + 1;
    const next = { ...cart, [key]: { supplier: it.supplier, name: it.name, unit: it.unit, price: it.price, qty } };
    setCart(next);
    writeCart(user.uid, next);
  }

  if (authLoading || !allowed) return null;

  const count = results.length;
  const noun = count === 1 ? "item" : "items";
  const summary = trimmed
    ? `${count} ${noun} found for “${trimmed}”`
    : supplier
      ? `${count} ${noun} from ${supplier}`
      : `${count} ${noun}`;
  const inCart = cartCount(cart);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button type="button" className={styles.backBtn} aria-label="Back" onClick={goBack}>
          <BackIcon />
        </button>
        <h1 className={styles.title}>Item Search</h1>
        <p className={styles.subtitle}>Check item prices by supplier.</p>
        <Link
          href="/operations/cart"
          className={styles.cartLink}
          aria-label={inCart > 0 ? `Cart, ${inCart} in cart` : "Cart"}
        >
          <CartIcon />
          {inCart > 0 && <span className={styles.cartBadge}>{inCart}</span>}
        </Link>
      </header>

      <div className={styles.searchBox}>
        <span className={styles.searchIcon}>
          <SearchIcon />
        </span>
        <input
          className={styles.searchInput}
          type="text"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Search items"
          aria-label="Search items"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button
            type="button"
            className={styles.clearBtn}
            aria-label="Clear search"
            onClick={() => setQuery("")}
          >
            <CloseIcon />
          </button>
        )}
      </div>

      {list && (
        <div className={styles.chips} role="group" aria-label="Supplier">
          {["", ...list.suppliers].map((name) => (
            <button
              key={name || "all"}
              type="button"
              className={`${styles.chip} ${supplier === name ? styles.chipActive : ""}`}
              aria-pressed={supplier === name}
              onClick={() => setSupplier(name)}
            >
              {name || "All Suppliers"}
            </button>
          ))}
        </div>
      )}

      {loading && !list ? (
        <p className={styles.note}>Loading prices…</p>
      ) : error && !list ? (
        <div className={styles.errorBox}>
          <p className={styles.errorText}>{error}</p>
          <button type="button" className={styles.retryBtn} onClick={() => void load()}>
            Try again
          </button>
        </div>
      ) : list ? (
        <>
          <div className={styles.resultBar}>
            <p className={styles.count}>{summary}</p>
            <label className={styles.sort}>
              <span className={styles.srOnly}>Sort by</span>
              <select
                className={styles.sortSelect}
                value={sort}
                onChange={(e) => setSort(e.target.value as PriceSort)}
              >
                {SORT_ORDER.map((key) => (
                  <option key={key} value={key}>
                    {PRICE_SORT_LABELS[key]}
                  </option>
                ))}
              </select>
              <span className={styles.sortChevron}>
                <ChevronIcon />
              </span>
            </label>
          </div>

          {count === 0 ? (
            <p className={styles.note}>
              {trimmed ? `No items match “${trimmed}”.` : "No items to show."}
            </p>
          ) : (
            <ul className={styles.list}>
              {results.slice(0, shown).map((it) => {
                const key = cartKeyOf(it);
                const updated = formatUpdated(it.updatedAt);
                const open = openKey === key;
                return (
                  <li key={key} className={styles.card}>
                    <button
                      type="button"
                      className={styles.head}
                      aria-expanded={open}
                      onClick={() => setOpenKey(open ? null : key)}
                    >
                      <div className={styles.body}>
                        <p className={styles.name}>{it.name}</p>
                        <p className={styles.supplier}>{it.supplier}</p>
                      </div>
                      <div className={styles.priceCol}>
                        <p className={styles.price}>
                          <span className={styles.amount}>{formatPrice(it.price)}</span>
                          <span className={styles.unit}> / {it.unit}</span>
                        </p>
                        {updated && <p className={styles.updated}>{updated}</p>}
                      </div>
                      <span className={`${styles.rowChevron} ${open ? styles.rowChevronOpen : ""}`}>
                        <ChevronIcon />
                      </span>
                    </button>

                    {open && (
                      <div className={styles.detail}>
                        <p className={styles.detailTitle}>Price history</p>
                        {it.history && it.history.length >= 2 ? (
                          <PriceHistoryChart points={it.history} />
                        ) : (
                          <p className={styles.detailNote}>No price changes recorded.</p>
                        )}
                      </div>
                    )}

                    <div className={styles.foot}>
                      <button
                        type="button"
                        className={styles.addBtn}
                        aria-label={`Add ${it.name} to the cart`}
                        onClick={() => addToCart(it)}
                      >
                        <PlusIcon />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {count > shown && (
            <button
              type="button"
              className={styles.moreBtn}
              onClick={() => setShown((n) => n + PAGE_SIZE)}
            >
              Show more ({count - shown} left)
            </button>
          )}
        </>
      ) : null}
    </div>
  );
}
