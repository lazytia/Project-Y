"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { isOwnerOrChef } from "@/lib/permissions";
import type { PriceList } from "@/lib/price-list-parse";
import {
  PRICE_SORT_LABELS,
  filterItems,
  formatPrice,
  formatUpdated,
  sortItems,
  type PriceSort,
} from "@/lib/price-list-search";
import styles from "./page.module.css";

/** Rows drawn at a time. The list is a few hundred long; a phone need not paint it all. */
const PAGE_SIZE = 50;

/** Give up on the read rather than leave the page on its loading line. */
const FETCH_TIMEOUT_MS = 20 * 1000;

const SORT_ORDER: PriceSort[] = ["name", "updated", "price-asc", "price-desc"];

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

function BoxIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 8l-9-5-9 5 9 5 9-5z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <line x1="12" y1="13" x2="12" y2="21" />
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

export default function ItemSearchPage() {
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwnerOrChef(user);

  const [list, setList] = useState<PriceList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [supplier, setSupplier] = useState("");
  const [sort, setSort] = useState<PriceSort>("name");
  const [shown, setShown] = useState(PAGE_SIZE);

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

  // A new search starts from the top of its results again.
  useEffect(() => {
    setShown(PAGE_SIZE);
  }, [query, supplier, sort]);

  const trimmed = query.trim();
  const results = useMemo(
    () => (list ? sortItems(filterItems(list.items, query, supplier), sort) : []),
    [list, query, supplier, sort],
  );

  if (authLoading || !allowed) return null;

  const count = results.length;
  const noun = count === 1 ? "item" : "items";
  const summary = trimmed
    ? `${count} ${noun} found for “${trimmed}”`
    : supplier
      ? `${count} ${noun} from ${supplier}`
      : `${count} ${noun}`;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Item Search</h1>
        <p className={styles.subtitle}>Check item prices by supplier.</p>
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
                const updated = formatUpdated(it.updatedAt);
                return (
                  <li key={`${it.supplier}::${it.name}`} className={styles.card}>
                    <span className={styles.thumb}>
                      <BoxIcon />
                    </span>
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
