"use client";

import { useEffect, useState } from "react";
import { getDb } from "@/lib/firebase";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import styles from "./page.module.css";

type Category = {
  id: string;
  name: string;
  items: string[];
  icon: "squid" | "fish";
};

const CATEGORIES: Category[] = [
  {
    id: "squid",
    name: "SQUID",
    icon: "squid",
    items: ["Squid Karaage", "Squid Sashimi", "Squid Salad"],
  },
  {
    id: "snapper",
    name: "SNAPPER",
    icon: "fish",
    items: ["Snapper Aburi", "Snapper Sashimi", "Snapper Sushi", "Spicy Snapper Tataki"],
  },
  {
    id: "trevally",
    name: "TREVALLY",
    icon: "fish",
    items: ["Trevally Aburi", "Trevally Sashimi", "Trevally Sushi", "Spicy Trevally Tataki"],
  },
  {
    id: "tuna",
    name: "TUNA",
    icon: "fish",
    items: ["Tuna Aburi", "Tuna Sashimi", "Tuna Sushi", "Spicy Tuna Tataki"],
  },
];

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
      <path d="M12 3c-3 0-5 2-5 5v5c0 2 1 3 2 4l1 3m2-12c0 0 0 8 0 12m2-12c0 0 0 8 0 12m-6-5c0 0-1 2-2 2m10-2c0 0 1 2 2 2" />
      <ellipse cx="12" cy="8" rx="5" ry="4" />
      <circle cx="10" cy="7" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="14" cy="7" r="0.8" fill="currentColor" stroke="none" />
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

  const [soldOutIds, setSoldOutIds] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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
    const isCurrentlySoldOut = soldOutIds.includes(id);
    const next = isCurrentlySoldOut
      ? soldOutIds.filter((x) => x !== id)
      : [...soldOutIds, id];
    // Auto-expand when marking sold out
    if (!isCurrentlySoldOut) {
      setExpanded((prev) => new Set([...prev, id]));
    }
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

      <ul className={styles.list}>
        {CATEGORIES.map((cat) => {
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
                    {cat.icon === "squid" ? <SquidIcon /> : <FishIcon />}
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
