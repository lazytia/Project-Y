"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
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

function weekdayMonFirst(d: Date): number {
  return (d.getDay() + 6) % 7;
}

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
  const { user } = useAuth();
  const [serverOrders, setServerOrders] = useState<CateringOrder[]>([]);
  // Square's order search is eventually consistent — after a cancel, the
  // just-cancelled row still appears as OPEN for ~30s; after a create,
  // the new row is missing for ~30s. We hold these locally so the UI
  // reflects user actions immediately and self-heals once Square's index
  // catches up.
  const [cancelledIds, setCancelledIds] = useState<Set<string>>(new Set());
  const [pendingAdds, setPendingAdds] = useState<CateringOrder[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState<Date>(() => new Date());
  const [modalDay, setModalDay] = useState<string | null>(null);
  const today = todayISO();

  async function reload(signal?: AbortSignal) {
    if (!user) return;
    try {
      const list = await fetchCateringOrders(user, signal);
      setServerOrders(list);
      setLoadError(null);
      // Reconcile local overrides once Square's index has caught up.
      const ids = new Set(list.map((o) => o.id));
      setCancelledIds((prev) => {
        // Drop any cancelled id Square is no longer returning (= synced).
        const next = new Set<string>();
        for (const id of prev) if (ids.has(id)) next.add(id);
        return next;
      });
      setPendingAdds((prev) => prev.filter((o) => !ids.has(o.id)));
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setLoadError(err instanceof Error ? err.message : "Could not load orders.");
    } finally {
      setLoading(false);
    }
  }

  const orders = useMemo(() => {
    // pendingAdds always wins over a stale server copy for the same ID.
    // This covers both new orders (Square index lag after create) and edited
    // orders (Square index lag after update).
    const pendingIds = new Set(pendingAdds.map((o) => o.id));
    const filtered = serverOrders.filter(
      (o) => !cancelledIds.has(o.id) && !pendingIds.has(o.id),
    );
    const merged = [...filtered, ...pendingAdds];
    merged.sort((a, b) => a.deliveryDateISO.localeCompare(b.deliveryDateISO));
    return merged;
  }, [serverOrders, cancelledIds, pendingAdds]);

  function removeOrderLocally(id: string) {
    setCancelledIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  function addOrderLocally(o: CateringOrder) {
    setPendingAdds((prev) => [...prev.filter((x) => x.id !== o.id), o]);
  }

  useEffect(() => {
    const controller = new AbortController();
    reload(controller.signal);
    // Pick up any order the /new page just saved while navigating back here.
    if (typeof window !== "undefined") {
      try {
        const raw = sessionStorage.getItem("catering-just-saved");
        if (raw) {
          const saved = JSON.parse(raw) as CateringOrder;
          if (saved?.id) addOrderLocally(saved);
          sessionStorage.removeItem("catering-just-saved");
        }
      } catch {
        /* ignore corrupted storage values */
      }
    }
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

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
              <p className={styles.statSub}>
                {nextOrder.fulfillmentType === "DELIVERY" ? "Delivery" : "Pickup"}
              </p>
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
            <button
              key={iso}
              type="button"
              onClick={() => setModalDay(iso)}
              className={`${styles.cell} ${inMonth ? "" : styles.cellOut}`}
            >
              {isNextOrderDay ? (
                <span className={styles.dayHighlight}>{date.getDate()}</span>
              ) : (
                <span className={`${styles.dayNum} ${iso === today ? styles.dayToday : ""}`}>
                  {date.getDate()}
                </span>
              )}
              {dayOrders.slice(0, 1).map((o) => (
                <span key={o.id} className={styles.cellOrder}>
                  {!isNextOrderDay || o.id !== nextOrder!.id ? (
                    <span className={styles.cellDot} aria-hidden="true" />
                  ) : null}
                  <span className={styles.cellName}>
                    {o.fulfillmentType === "DELIVERY" ? "D" : "P"}
                  </span>
                  <span className={styles.cellPax}>{o.deliveryTime.toLowerCase()}</span>
                  <span className={styles.cellDay}>{dCountdownLabel(o.deliveryDateISO)}</span>
                </span>
              ))}
              {dayOrders.length > 1 ? (
                <span className={styles.cellMore}>+{dayOrders.length - 1}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className={styles.upcomingHead}>
        <p className={styles.upcomingTitle}>UPCOMING ORDER</p>
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
          <p className={styles.upcomingClient}>
            {nextOrder.companyName
              || nextOrder.contactName
              || `Order #${nextOrder.id.slice(-4).toUpperCase()}`}
          </p>
          <ul className={styles.upcomingFacts}>
            <li>
              <span className={styles.upcomingFactIcon}>🕒</span>
              {nextOrder.deliveryTime} {nextOrder.fulfillmentType === "DELIVERY" ? "Delivery" : "Pickup"}
            </li>
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
          <span className={styles.viewDetailsBtn}>VIEW DETAILS &rsaquo;</span>
        </Link>
      ) : (
        <p className={styles.empty}>No upcoming orders.</p>
      )}

      {modalDay && (
        <DayModal
          day={modalDay}
          orders={ordersByDate[modalDay] ?? []}
          onClose={() => setModalDay(null)}
          onChanged={reload}
          onLocalRemove={removeOrderLocally}
        />
      )}
    </div>
  );
}

function DayModal({
  day, orders, onClose, onChanged, onLocalRemove,
}: {
  day: string;
  orders: CateringOrder[];
  onClose: () => void;
  onChanged: () => Promise<void>;
  onLocalRemove: (id: string) => void;
}) {
  const { user } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitDelete(orderId: string) {
    if (!user) return;
    if (!confirm("Cancel this catering order in Square?")) return;
    setSubmitting(true);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/catering-orders/${encodeURIComponent(orderId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status})`);
      // Square's order search is eventually consistent — purge the cancelled
      // order from local state immediately so the calendar reflects reality
      // even before the next refetch catches up.
      onLocalRemove(orderId);
      // Best-effort background refresh; if it still returns the stale row
      // Square's index will sync within a few seconds.
      onChanged().catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel order.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div>
            <p className={styles.modalDay}>{day}</p>
            <p className={styles.modalSub}>{orders.length} order{orders.length === 1 ? "" : "s"}</p>
          </div>
          <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close">×</button>
        </div>

        {orders.length > 0 ? (
          <ul className={styles.modalList}>
            {orders.map((o) => (
              <li key={o.id} className={styles.modalListItem}>
                <Link href={`/operations/catering-orders/${o.id}`} className={styles.modalListLink}>
                  <span className={styles.modalListName}>{o.clientName}</span>
                  <span className={styles.modalListMeta}>{o.deliveryTime} · {o.guestsCount} pax · {fmtMoney(o.totalAmount)}</span>
                </Link>
                {o.status !== "COMPLETED" && o.status !== "CANCELLED" && (
                  <button
                    type="button"
                    className={styles.modalDeleteBtn}
                    onClick={() => submitDelete(o.id)}
                    disabled={submitting}
                  >
                    Cancel
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        {error ? <p className={styles.error}>{error}</p> : null}
        <Link
          href={`/operations/catering-orders/new?date=${encodeURIComponent(day)}`}
          className={styles.modalPrimary}
        >
          Create order
        </Link>
      </div>
    </div>
  );
}
