"use client";

import { useEffect, useState } from "react";
import { getDb } from "@/lib/firebase";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { useAuth } from "@/components/AuthProvider";
import styles from "./page.module.css";

type Category = {
  id: string;
  name: string;
  subName?: string;
  items: string[];
  icon: "squid" | "fish";
};

type ApiCategory = {
  categoryId: string;
  displayName: string;
  subName?: string;
  itemCount: number;
  resetRule: string;
  affectedItems: string[];
};

function FishIcon() {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6.5 12c0 0-2-4 3-6s9 2 9 6-4 8-9 6-3-6-3-6z" />
      <circle cx="15" cy="11" r="1" fill="currentColor" stroke="none" />
      <path d="M3 12c0 0 1-3 3.5-3.5M3 12c0 0 1 3 3.5 3.5" />
    </svg>
  );
}

function SquidIcon() {
  // Bullet-shaped mantle on top, two eyes, eight tentacles below.
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Mantle (bullet shape) */}
      <path d="M12 2.5c-3.4 0-5.5 2.5-5.5 5.5v4c0 1.8 1 2.8 2 3.4h7c1-.6 2-1.6 2-3.4V8c0-3-2.1-5.5-5.5-5.5z" />
      {/* Fins */}
      <path d="M6.5 9c-1.5 0.4-2.5 1.4-2.5 2.6 0 0.7 0.5 1.2 1 1.4" />
      <path d="M17.5 9c1.5 0.4 2.5 1.4 2.5 2.6 0 0.7-0.5 1.2-1 1.4" />
      {/* Eyes */}
      <circle cx="9.8" cy="8.2" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="14.2" cy="8.2" r="0.8" fill="currentColor" stroke="none" />
      {/* Tentacles */}
      <path d="M8 15.5c-0.3 1.3-1.2 2.5-2 3.5" />
      <path d="M9.5 15.7c-0.2 1.5-0.5 3-1 4.3" />
      <path d="M11 15.8c-0.1 1.7-0.1 3.3 0.2 4.7" />
      <path d="M13 15.8c0.1 1.7 0.1 3.3-0.2 4.7" />
      <path d="M14.5 15.7c0.2 1.5 0.5 3 1 4.3" />
      <path d="M16 15.5c0.3 1.3 1.2 2.5 2 3.5" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export default function DailySoldOutPage() {
  const today = new Date().toLocaleDateString("en-CA");
  const { user } = useAuth();

  const [soldOutIds, setSoldOutIds] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const db = getDb();
    const ref = doc(db, "sold_out_daily", today);
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        setSoldOutIds((snap.data().soldOutIds as string[]) ?? []);
      } else {
        setSoldOutIds([]);
      }
    });
    return unsub;
  }, [today]);

  // Pull the live menu from Square so the page always reflects the
  // catalog rather than a hard-coded item list.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/menu/sold-out-categories", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status})`);
        const list = (data?.dailySoldOutCategories ?? []) as ApiCategory[];
        setCategories(
          list.map((c) => ({
            id: c.categoryId,
            name: c.displayName.toUpperCase(),
            subName: c.subName,
            items: c.affectedItems,
            icon: c.categoryId === "squid" ? "squid" : "fish",
          })),
        );
        setMenuError(null);
      } catch (err) {
        setMenuError(err instanceof Error ? err.message : "Could not load menu.");
      }
    })();
  }, []);

  async function toggleSoldOut(id: string) {
    if (busyId) return;
    const db = getDb();
    const ref = doc(db, "sold_out_daily", today);
    const isCurrentlySoldOut = soldOutIds.includes(id);
    const next = isCurrentlySoldOut
      ? soldOutIds.filter((x) => x !== id)
      : [...soldOutIds, id];
    // Auto-expand when marking sold out
    if (!isCurrentlySoldOut) {
      setExpanded((prev) => new Set([...prev, id]));
    }
    setBusyId(id);
    setMenuError(null);
    try {
      // 1. Mirror state in Firestore so other surfaces (and the cards
      //    on this page) update straight away.
      await setDoc(ref, { soldOutIds: next, date: today }, { merge: true });
      // 2. Push the same change into Square so POS + Online Ordering
      //    flip availability in real time.
      if (user) {
        const idToken = await user.getIdToken();
        const res = await fetch("/api/menu/set-sold-out", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ categoryId: id, soldOut: !isCurrentlySoldOut }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error ?? `Square update failed (${res.status})`);
        }
      }
    } catch (err) {
      // Roll back the Firestore flip so the UI doesn't lie about
      // Square state.
      await setDoc(ref, { soldOutIds, date: today }, { merge: true });
      setMenuError(err instanceof Error ? err.message : "Square update failed.");
    } finally {
      setBusyId(null);
    }
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const soldOutCount = soldOutIds.length;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Daily Sold Out</h1>
        <p className={styles.subtitle}>
          Sold out items will show as{" "}
          <span className={styles.subtitleAccent}>unavailable</span> on POS and
          Online Ordering until tonight.
        </p>
      </div>

      {menuError && (
        <p style={{ fontSize: 12, color: "#c14545", textAlign: "center", margin: "8px 0 0" }}>
          {menuError}
        </p>
      )}

      <ul className={styles.list}>
        {categories.map((cat) => {
          const isSoldOut = soldOutIds.includes(cat.id);
          const isOpen = expanded.has(cat.id);
          return (
            <li key={cat.id} className={styles.categoryCard}>
              <div className={styles.categoryRow}>
                <button
                  type="button"
                  className={styles.expandTrigger}
                  onClick={() => toggleExpanded(cat.id)}
                  aria-expanded={isOpen}
                  aria-label={isOpen ? `Collapse ${cat.name} item list` : `Expand ${cat.name} item list`}
                >
                  <div
                    className={`${styles.categoryIcon} ${isSoldOut ? styles.categoryIconSoldOut : ""}`}
                  >
                    {cat.icon === "squid" ? <SquidIcon /> : <FishIcon />}
                  </div>

                  <div className={styles.categoryInfo}>
                    <div
                      className={`${styles.categoryName} ${isSoldOut ? styles.categoryNameSoldOut : ""}`}
                    >
                      {cat.name}
                      {cat.subName ? (
                        <span style={{ fontWeight: 500, marginLeft: 6, opacity: 0.7 }}>
                          ({cat.subName})
                        </span>
                      ) : null}
                    </div>
                    <div
                      className={`${styles.categoryCount} ${isSoldOut ? styles.categoryCountSoldOut : ""}`}
                    >
                      {cat.items.length} item{cat.items.length !== 1 ? "s" : ""}
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  className={styles.statusWrap}
                  onClick={() => toggleSoldOut(cat.id)}
                  disabled={busyId === cat.id}
                  aria-label={
                    isSoldOut
                      ? `Mark ${cat.name} as available`
                      : `Mark ${cat.name} as sold out`
                  }
                >
                  <div
                    className={`${styles.statusDot} ${isSoldOut ? styles.statusDotSoldOut : ""}`}
                  />
                  <span
                    className={`${styles.statusLabel} ${isSoldOut ? styles.statusLabelSoldOut : ""}`}
                  >
                    {isSoldOut ? "SOLD OUT" : "AVAILABLE"}
                  </span>
                </button>

                <button
                  type="button"
                  className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ""}`}
                  onClick={() => toggleExpanded(cat.id)}
                  aria-label={isOpen ? "Collapse" : "Expand"}
                >
                  <ChevronIcon />
                </button>
              </div>

              {isOpen && cat.items.length > 0 && (
                <ul className={styles.itemList}>
                  {cat.items.map((item, idx) => (
                    <li key={`${item}-${idx}`} className={styles.item}>
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      <div className={styles.summary}>
        <div className={styles.summaryBadge}>{soldOutCount}</div>
        <div className={styles.summaryTitle}>
          {soldOutCount === 1
            ? "ONE ITEM CATEGORY SOLD OUT UNTIL TONIGHT"
            : `${soldOutCount === 0 ? "NO" : soldOutCount} CATEGORIES SOLD OUT UNTIL TONIGHT`}
        </div>
        <div className={styles.summaryReset}>Resets tomorrow automatically.</div>
      </div>
    </div>
  );
}
