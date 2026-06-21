"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  type CateringOrder,
  dCountdownLabel,
  daysUntil,
  fetchCateringOrders,
  todayISO,
} from "@/lib/catering-orders";
import styles from "./page.module.css";

const MONTH_NAMES = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];
const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

function fmtMoney(n: number): string {
  return `$${n.toLocaleString("en-AU", { maximumFractionDigits: 0 })}`;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Mon-first weekday index (0..6). */
function weekdayMonFirst(d: Date): number {
  return (d.getDay() + 6) % 7;
}

/** Start of current week (Monday) for a given date. */
function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setDate(x.getDate() - weekdayMonFirst(x));
  x.setHours(0, 0, 0, 0);
  return x;
}

function ChevronLeft() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 6 9 12 15 18" />
    </svg>
  );
}
function ChevronRight() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

export default function CateringOrdersPage() {
  const [orders, setOrders] = useState<CateringOrder[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState<Date>(() => new Date());
  const today = todayISO();

  useEffect(() => {
    (async () => {
      try {
        const list = await fetchCateringOrders();
        setOrders(list);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Could not load orders.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const ordersByDate = useMemo(() => {
    const m: Record<string, CateringOrder[]> = {};
    for (const o of orders) {
      (m[o.deliveryDateISO] ??= []).push(o);
    }
    return m;
  }, [orders]);

  const thisWeekCount = useMemo(() => {
    const start = startOfWeek(new Date());
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const startISO = isoOf(start);
    const endISO = isoOf(end);
    return orders.filter((o) => o.deliveryDateISO >= startISO && o.deliveryDateISO < endISO).length;
  }, [orders]);

  const nextOrder = useMemo(() => {
    return orders.find((o) => daysUntil(o.deliveryDateISO) >= 0) ?? null;
  }, [orders]);

  // Build the calendar grid for the cursor month.
  const monthGrid = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const gridStart = startOfWeek(first);
    const cells: Array<{ date: Date; iso: string; inMonth: boolean }> = [];
    for (let i = 0; i < 42; i += 1) {
      const d = new Date(gridStart);
      d.setDate(d.getDate() + i);
      cells.push({
        date: d,
        iso: isoOf(d),
        inMonth: d.getMonth() === cursor.getMonth(),
      });
    }
    return cells;
  }, [cursor]);

  function gotoMonth(delta: number) {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>CATERING ORDERS</h1>

      <div className={styles.statRow}>
        <div className={styles.statCard}>
          <p className={styles.statLabel}>THIS WEEK</p>
          <p className={styles.statBig}>{thisWeekCount}</p>
          <p className={styles.statSub}>Orders</p>
        </div>
        <div className={styles.statCard}>
          <p className={styles.statLabel}>NEXT ORDER</p>
          {nextOrder ? (
            <>
              <p className={`${styles.statBig} ${styles.warm}`}>
                {dCountdownLabel(nextOrder.deliveryDateISO)}
              </p>
              <p className={styles.statSub}>{nextOrder.clientName}</p>
            </>
          ) : (
            <>
              <p className={`${styles.statBig} ${styles.muted}`}>—</p>
              <p className={styles.statSub}>None scheduled</p>
            </>
          )}
        </div>
      </div>

      <div className={styles.calendarHeader}>
        <button type="button" className={styles.navBtn} onClick={() => gotoMonth(-1)} aria-label="Previous month">
          <ChevronLeft />
        </button>
        <p className={styles.monthLabel}>
          {MONTH_NAMES[cursor.getMonth()]} {cursor.getFullYear()}
        </p>
        <button type="button" className={styles.navBtn} onClick={() => gotoMonth(1)} aria-label="Next month">
          <ChevronRight />
        </button>
      </div>

      <div className={styles.weekRow}>
        {WEEKDAYS.map((w) => (
          <div key={w} className={styles.weekLabel}>{w}</div>
        ))}
      </div>

      <div className={styles.gridBody}>
        {monthGrid.map(({ date, iso, inMonth }) => {
          const dayOrders = ordersByDate[iso] ?? [];
          const isNextOrderDay = nextOrder?.deliveryDateISO === iso;
          return (
            <div
              key={iso}
              className={`${styles.cell} ${inMonth ? "" : styles.cellOut}`}
            >
              {isNextOrderDay ? (
                <Link href={`/operations/catering-orders/${nextOrder!.id}`} className={styles.dayHighlight}>
                  {date.getDate()}
                </Link>
              ) : (
                <span className={`${styles.dayNum} ${iso === today ? styles.dayToday : ""}`}>
                  {date.getDate()}
                </span>
              )}
              {dayOrders.map((o) => (
                <Link
                  key={o.id}
                  href={`/operations/catering-orders/${o.id}`}
                  className={styles.cellOrder}
                >
                  {!isNextOrderDay || o.id !== nextOrder!.id ? (
                    <span className={styles.cellDot} aria-hidden="true" />
                  ) : null}
                  <span className={styles.cellName}>{o.clientName}</span>
                  <span className={styles.cellPax}>{o.guestsCount} pax</span>
                  <span className={styles.cellDay}>{dCountdownLabel(o.deliveryDateISO)}</span>
                </Link>
              ))}
            </div>
          );
        })}
      </div>

      {/* Upcoming order summary */}
      <div className={styles.upcomingHead}>
        <p className={styles.upcomingTitle}>UPCOMING ORDER</p>
        {orders.length > 0 ? (
          <Link href="/operations/catering-orders/list" className={styles.viewAll}>VIEW ALL</Link>
        ) : null}
      </div>

      {loading ? (
        <p className={styles.empty}>Loading…</p>
      ) : loadError ? (
        <p className={styles.error}>{loadError}</p>
      ) : nextOrder ? (
        <Link href={`/operations/catering-orders/${nextOrder.id}`} className={styles.upcomingCard}>
          <p className={styles.upcomingDay}>
            {(() => {
              const n = daysUntil(nextOrder.deliveryDateISO);
              if (n === 0) return "TODAY";
              if (n === 1) return `TOMORROW · ${dCountdownLabel(nextOrder.deliveryDateISO)}`;
              return `IN ${n} DAYS · ${dCountdownLabel(nextOrder.deliveryDateISO)}`;
            })()}
          </p>
          <p className={styles.upcomingClient}>{nextOrder.clientName}</p>
          <ul className={styles.upcomingFacts}>
            <li><span className={styles.upcomingFactIcon}>🕒</span>{nextOrder.deliveryTime} Delivery</li>
            <li><span className={styles.upcomingFactIcon}>👥</span>{nextOrder.guestsCount} Guests</li>
            <li><span className={styles.upcomingFactIcon}>＄</span>{fmtMoney(nextOrder.totalAmount)}</li>
          </ul>

          {nextOrder.menu.length > 0 ? (
            <>
              <p className={styles.menuTitle}>MENU SUMMARY</p>
              <ul className={styles.menuList}>
                {nextOrder.menu.slice(0, 6).map((m, idx) => (
                  <li key={`${m.name}-${idx}`} className={styles.menuLine}>
                    <span>{m.name}</span>
                    <span className={styles.menuQty}>x {m.qty}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {nextOrder.deliveryAddressLines.length > 0 ? (
            <>
              <p className={styles.menuTitle}>DELIVERY ADDRESS</p>
              <p className={styles.address}>
                {nextOrder.deliveryAddressLines.map((line, idx) => (
                  <span key={idx} style={{ display: "block" }}>{line}</span>
                ))}
              </p>
            </>
          ) : null}

          <span className={styles.viewDetailsBtn}>VIEW DETAILS &rsaquo;</span>
        </Link>
      ) : (
        <p className={styles.empty}>No upcoming orders.</p>
      )}
    </div>
  );
}
