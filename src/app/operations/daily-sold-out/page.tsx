"use client";

import { useEffect, useState } from "react";
import { getDb } from "@/lib/firebase";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  orderBy,
  query,
} from "firebase/firestore";
import styles from "./page.module.css";

type Category = {
  id: string;
  name: string;
  items: string[];
  order: number;
};

function FishIcon() {
  return (
    <svg
      width="28"
      height="28"
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

  const [categories, setCategories] = useState<Category[]>([]);
  const [soldOutIds, setSoldOutIds] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    const db = getDb();
    getDocs(query(collection(db, "sold_out_categories"), orderBy("order"))).then(
      (snap) => {
        setCategories(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Category, "id">) }))
        );
      }
    );
  }, []);

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

  async function toggleSoldOut(id: string) {
    const db = getDb();
    const ref = doc(db, "sold_out_daily", today);
    const next = soldOutIds.includes(id)
      ? soldOutIds.filter((x) => x !== id)
      : [...soldOutIds, id];
    await setDoc(ref, { soldOutIds: next, date: today }, { merge: true });
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

      {categories.length === 0 ? (
        <p className={styles.empty}>No categories configured.</p>
      ) : (
        <ul className={styles.list}>
          {categories.map((cat) => {
            const isSoldOut = soldOutIds.includes(cat.id);
            const isOpen = expanded.has(cat.id);
            return (
              <li key={cat.id} className={styles.categoryCard}>
                <div
                  className={styles.categoryRow}
                  onClick={() => toggleExpanded(cat.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && toggleExpanded(cat.id)}
                >
                  <div
                    className={`${styles.categoryIcon} ${isSoldOut ? styles.categoryIconSoldOut : ""}`}
                  >
                    <FishIcon />
                  </div>

                  <div className={styles.categoryInfo}>
                    <div
                      className={`${styles.categoryName} ${isSoldOut ? styles.categoryNameSoldOut : ""}`}
                    >
                      {cat.name}
                    </div>
                    <div
                      className={`${styles.categoryCount} ${isSoldOut ? styles.categoryCountSoldOut : ""}`}
                    >
                      {cat.items.length} item{cat.items.length !== 1 ? "s" : ""}
                    </div>
                  </div>

                  <button
                    type="button"
                    className={styles.statusWrap}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSoldOut(cat.id);
                    }}
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
                      {isSoldOut ? "SOLD OUT TODAY" : "AVAILABLE"}
                    </span>
                  </button>

                  <span
                    className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ""}`}
                  >
                    <ChevronIcon />
                  </span>
                </div>

                {isOpen && cat.items.length > 0 && (
                  <ul className={styles.itemList}>
                    {cat.items.map((item) => (
                      <li key={item} className={styles.item}>
                        {item}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {categories.length > 0 && (
        <div className={styles.summary}>
          <div className={styles.summaryBadge}>{soldOutCount}</div>
          <div className={styles.summaryTitle}>
            {soldOutCount === 1
              ? "ONE ITEM CATEGORY SOLD OUT UNTIL TONIGHT"
              : `${soldOutCount === 0 ? "NO" : soldOutCount} CATEGORIES SOLD OUT UNTIL TONIGHT`}
          </div>
          <div className={styles.summaryReset}>Resets tomorrow automatically.</div>
        </div>
      )}
    </div>
  );
}
