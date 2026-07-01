"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import styles from "./page.module.css";
import CalendarPicker from "@/components/CalendarPicker";
import ManagerDashboard from "@/components/ManagerDashboard";
import { useAuth } from "@/components/AuthProvider";
import { isOwner, isStrictOwner } from "@/lib/permissions";
import {
  type Reservation,
  fetchReservationsForDate,
  serviceFor,
} from "@/lib/reservations";
import {
  type CateringOrder,
  fetchCateringOrders,
  dCountdownLabel,
  daysUntil,
} from "@/lib/catering-orders";

const SYDNEY_TZ = "Australia/Sydney";

function sydneyTodayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: SYDNEY_TZ });
}

function dowOfDateKey(dateKey: string): number {
  // Anchor at noon avoids DST edge cases.
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

function formatDateLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

const WEEKLY_TARGET = 30_000;

/**
 * 요일별 일간 타겟 — 지난 6개월 실적 기반 가중치 배분
 * 전체 $479,297.38 중 각 요일 비율 × $30,000 (일요일 휴무)
 * 0=일, 1=월, 2=화, 3=수, 4=목, 5=금, 6=토
 */
const DAILY_TARGETS: Record<number, number> = {
  0: 0,      // 일 (휴무)
  1: 3_800,  // 월 (12.7%)
  2: 5_200,  // 화 (17.3%)
  3: 5_500,  // 수 (18.3%)
  4: 6_500,  // 목 (21.7%)
  5: 6_000,  // 금 (20.0%)
  6: 3_000,  // 토 (10.0%)
};

const POLL_INTERVAL_MS = 30_000;

const mock = {
  projectedTables: 18,
};

function fmt(n: number) {
  return "$" + n.toLocaleString("en-US");
}

function Progress({ value, max }: { value: number; max: number }) {
  const pct = Math.round((value / max) * 100);
  const fillPct = Math.min(pct, 100);
  return (
    <div className={styles.progressRow}>
      <div className={styles.progressTrack}>
        <div className={styles.progressFill} style={{ width: `${fillPct}%` }} />
      </div>
      <span className={styles.progressPct}>{pct}%</span>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const userIsManager = isOwner(user) && !isStrictOwner(user);
  if (userIsManager) {
    return <ManagerDashboard />;
  }
  return <OwnerDashboard />;
}

function OwnerDashboard() {
  const { user } = useAuth();
  const [todayKey, setTodayKey] = useState("");
  const [selectedDate, setSelectedDate] = useState<string>("");

  useEffect(() => {
    const key = sydneyTodayKey();
    setTodayKey(key);
    setSelectedDate(key);
  }, []);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [rangeDates, setRangeDates] = useState<{ start: string; end: string } | null>(null);
  const isRangeMode = rangeDates !== null;
  const isToday = !isRangeMode && selectedDate === todayKey;
  const dailyTarget = selectedDate ? (DAILY_TARGETS[dowOfDateKey(selectedDate)] ?? 0) : 0;

  const [stats, setStats] = useState<{
    todaySales: number;
    transactions: number;
    transactionsChange: number;
    avgSpendPerTable: number;
    avgSpendChange: number;
    restaurantSales: number;
    platterSales: number;
    weeklyProgress: number;
    peakHour: string | null;
    peakHourOrders: number;
    bestSellers: { name: string; sales: number; quantity: number }[];
  } | null>(null);
  const [reservations, setReservations] = useState<Reservation[] | null>(null);
  const [cateringOrders, setCateringOrders] = useState<CateringOrder[] | null>(null);
  const [rangeStats, setRangeStats] = useState<{
    todaySales: number;
    restaurantSales: number;
    platterSales: number;
    transactions: number;
    avgSpendPerTable: number;
    bestSellers: { name: string; sales: number; quantity: number }[];
    days: number;
  } | null>(null);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [statsError, setStatsError] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchStats = useCallback(async (dateKey: string) => {
    try {
      const url = `/api/square/today-stats?date=${encodeURIComponent(dateKey)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStats(data);
      setStatsError(false);
      setLastUpdated(new Date());
    } catch (err) {
      console.error("[Square] fetch error:", err);
      setStatsError(true);
    }
  }, []);

  const fetchReservations = useCallback(async (dateKey: string) => {
    try {
      const data = await fetchReservationsForDate(user, dateKey, "northsydney");
      setReservations(data);
    } catch (err) {
      console.error("[reservations] fetch error:", err);
    }
  }, [user]);

  const fetchCatering = useCallback(async () => {
    try {
      const orders = await fetchCateringOrders(user);
      setCateringOrders(orders);
    } catch (err) {
      console.error("[catering] fetch error:", err);
    }
  }, [user]);

  // Reset displayed values on date change so we don't briefly show stale numbers.
  useEffect(() => {
    if (!selectedDate) return;
    setStats(null);
    setReservations(null);
    setLastUpdated(null);
    fetchStats(selectedDate);
    fetchReservations(selectedDate);
    fetchCatering();
    // Live poll only when viewing today — historical days don't change.
    if (!isToday) return;
    const id1 = setInterval(() => fetchStats(selectedDate), POLL_INTERVAL_MS);
    const id2 = setInterval(() => fetchReservations(selectedDate), POLL_INTERVAL_MS);
    return () => {
      clearInterval(id1);
      clearInterval(id2);
    };
  }, [selectedDate, isToday, fetchStats, fetchReservations, fetchCatering]);

  // Range fetch
  useEffect(() => {
    if (!rangeDates) { setRangeStats(null); return; }
    setRangeStats(null);
    setRangeLoading(true);
    fetch(`/api/square/range-stats?startDate=${rangeDates.start}&endDate=${rangeDates.end}`)
      .then(r => r.json())
      .then(d => { setRangeStats(d); setRangeLoading(false); })
      .catch(() => setRangeLoading(false));
  }, [rangeDates]);

  const resCounts = useMemo(() => {
    if (!reservations) return null;
    const active = reservations.filter(
      (r) => r.status !== "cancelled" && r.status !== "no-show",
    );
    const lunch = active.filter((r) => serviceFor(r.time) === "LUNCH");
    const dinner = active.filter((r) => serviceFor(r.time) === "DINNER");
    return {
      lunchPax: lunch.reduce((s, r) => s + r.count, 0),
      lunchBookings: lunch.length,
      dinnerPax: dinner.reduce((s, r) => s + r.count, 0),
      dinnerBookings: dinner.length,
    };
  }, [reservations]);

  const totalPax = resCounts
    ? resCounts.lunchPax + resCounts.dinnerPax
    : null;
  const totalBookings = resCounts
    ? resCounts.lunchBookings + resCounts.dinnerBookings
    : null;

  // Next upcoming catering order (confirmed/pending, delivery date >= today)
  const nextCatering = useMemo(() => {
    if (!cateringOrders) return null;
    const upcoming = cateringOrders
      .filter(
        (o) =>
          (o.status === "CONFIRMED" || o.status === "PENDING") &&
          o.deliveryDateISO >= todayKey,
      )
      .sort((a, b) => a.deliveryDateISO.localeCompare(b.deliveryDateISO));
    return upcoming.length > 0 ? upcoming[0] : null;
  }, [cateringOrders, todayKey]);

  // This week's catering orders count
  const weekCateringCount = useMemo(() => {
    if (!cateringOrders || !todayKey) return null;
    // Get Monday of this week from todayKey (avoids new Date() during render)
    const [y, m, d] = todayKey.split("-").map(Number);
    const today = new Date(y, m - 1, d);
    const dayOfWeek = today.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(today);
    monday.setDate(today.getDate() + mondayOffset);
    const mondayKey = monday.toLocaleDateString("en-CA", { timeZone: SYDNEY_TZ });
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const sundayKey = sunday.toLocaleDateString("en-CA", { timeZone: SYDNEY_TZ });
    return cateringOrders.filter(
      (o) =>
        o.deliveryDateISO >= mondayKey &&
        o.deliveryDateISO <= sundayKey &&
        o.status !== "CANCELLED",
    ).length;
  }, [cateringOrders, todayKey]);

  const todaySales     = stats?.todaySales ?? null;
  const weeklyProgress = stats?.weeklyProgress ?? null;
  const transactions   = stats?.transactions ?? null;
  const transactionsChange = stats?.transactionsChange ?? null;
  const avgSpendPerTable   = stats?.avgSpendPerTable ?? null;
  const avgSpendChange     = stats?.avgSpendChange ?? null;
  const restaurantSales    = stats?.restaurantSales ?? null;
  const platterSales       = stats?.platterSales ?? null;
  const peakHour           = stats?.peakHour ?? null;
  const peakHourOrders     = stats?.peakHourOrders ?? null;
  const bestSellers        = stats?.bestSellers ?? [];
  const projectedTables    = mock.projectedTables;

  const goToToday = () => setSelectedDate(todayKey);
  const goPrev = () => {
    const [y, m, d] = selectedDate.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - 1);
    setSelectedDate(dt.toISOString().slice(0, 10));
  };
  const goNext = () => {
    const [y, m, d] = selectedDate.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + 1);
    const next = dt.toISOString().slice(0, 10);
    if (next > todayKey) return; // never look beyond today
    setSelectedDate(next);
  };

  return (
    <div className={styles.page}>

      {/* DATE PICKER */}
      <section className={styles.datePickerBar}>
        <button
          type="button"
          className={styles.dateNavBtn}
          onClick={goPrev}
          disabled={isRangeMode}
          aria-label="Previous day"
        >‹</button>
        <button
          type="button"
          className={styles.dateCenter}
          onClick={() => setCalendarOpen(true)}
          aria-label="Open calendar"
        >
          {isRangeMode ? (
            <>
              <span className={styles.dateLabel}>
                {formatDateLabel(rangeDates!.start).split(",")[0]}&nbsp;–&nbsp;{formatDateLabel(rangeDates!.end).split(",")[0]}
              </span>
              <span className={styles.rangeBadge}>{rangeStats?.days ?? "…"} days</span>
            </>
          ) : (
            <>
              <span className={styles.dateLabel}>{formatDateLabel(selectedDate)}</span>
              <span className={styles.calendarIcon}>📅</span>
              {!isToday && <span className={styles.todayBadge}>not today</span>}
            </>
          )}
        </button>
        {isRangeMode ? (
          <button
            type="button"
            className={styles.dateNavBtn}
            onClick={() => setRangeDates(null)}
            aria-label="Clear range"
            title="Clear range"
          >✕</button>
        ) : (
          <button
            type="button"
            className={styles.dateNavBtn}
            onClick={goNext}
            disabled={isToday}
            aria-label="Next day"
          >›</button>
        )}
      </section>

      {calendarOpen && (
        <CalendarPicker
          value={selectedDate}
          maxDate={todayKey}
          onChange={(d) => { setRangeDates(null); setSelectedDate(d); }}
          onRangeChange={(start, end) => { setRangeDates({ start, end }); }}
          onClose={() => setCalendarOpen(false)}
        />
      )}

      {/* TODAY SALES — RESTAURANT / PLATTER 포함 */}
      <section className={styles.card}>
        <div className={styles.cardTopRow}>
          <p className={styles.cardLabel}>{isRangeMode ? "RANGE TOTAL" : "TODAY SALES"}</p>
          {isRangeMode && rangeLoading && <p className={styles.lastUpdated}>Loading…</p>}
          {!isRangeMode && lastUpdated && (
            <p className={styles.lastUpdated}>
              {lastUpdated.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })} updated
            </p>
          )}
          {statsError && <p className={styles.errorBadge}>Square 연결 오류</p>}
        </div>
        <p className={`${styles.salesAmount} ${(isRangeMode ? rangeStats?.todaySales : todaySales) === null || (isRangeMode && rangeLoading) ? styles.salesLoading : ""}`}>
          {isRangeMode
            ? (rangeStats ? fmt(rangeStats.todaySales) : "—")
            : (todaySales === null ? "—" : fmt(todaySales))}
        </p>
        {!isRangeMode && (
          <>
            <p className={styles.targetLabel}>Target&nbsp;&nbsp;<strong>{fmt(dailyTarget)}</strong></p>
            <Progress value={todaySales ?? 0} max={dailyTarget} />
          </>
        )}

        {/* 카드 내부 구분선 + 레스토랑/플래터 분리 */}
        <div className={styles.salesBreakRow}>
          <div className={styles.salesBreakItem}>
            <p className={styles.cardLabel}>RESTAURANT SALES</p>
            <p className={`${styles.salesBreakAmount} ${(isRangeMode ? rangeStats?.restaurantSales : restaurantSales) === null ? styles.salesLoading : ""}`}>
              {isRangeMode ? (rangeStats ? fmt(rangeStats.restaurantSales) : "—") : (restaurantSales === null ? "—" : fmt(restaurantSales))}
            </p>
          </div>
          <div className={styles.salesBreakDivider} />
          <div className={styles.salesBreakItem}>
            <p className={styles.cardLabel}>PLATTER SALES</p>
            <p className={`${styles.salesBreakAmount} ${(isRangeMode ? rangeStats?.platterSales : platterSales) === null ? styles.salesLoading : ""}`}>
              {isRangeMode ? (rangeStats ? fmt(rangeStats.platterSales) : "—") : (platterSales === null ? "—" : fmt(platterSales))}
            </p>
          </div>
        </div>
      </section>

      {/* TODAY'S OPERATIONS */}
      <p className={styles.sectionTitle}>TODAY&rsquo;S OPERATIONS</p>
      <div className={styles.splitRow}>
        {/* Today's Guests */}
        <section className={styles.splitCard}>
          <div className={styles.opsIconRow}>
            <span className={styles.opsIcon} aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </span>
            <span className={styles.opsLabel}>Today&rsquo;s Guests</span>
          </div>
          <p className={`${styles.opsValue} ${totalPax === null ? styles.salesLoading : ""}`}>
            {totalPax ?? "—"} <span className={styles.opsUnit}>Pax</span>
          </p>
          <p className={styles.opsSub}>{totalBookings ?? "—"} Reservations</p>
          <div className={styles.opsDivider} />
          <a href="/operations/reservations" className={styles.opsView}>
            View <span aria-hidden="true">→</span>
          </a>
        </section>

        {/* Next Catering */}
        <section className={styles.splitCard}>
          <div className={styles.opsIconRow}>
            <span className={styles.opsIcon} aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12h20" />
                <path d="M4 12c0-4.4 3.6-8 8-8s8 3.6 8 8" />
                <path d="M12 12v1" />
                <circle cx="12" cy="4" r="1" />
              </svg>
            </span>
            <span className={styles.opsLabel}>Next Catering</span>
          </div>
          {nextCatering ? (
            <>
              <p className={styles.opsCountdown}>
                {dCountdownLabel(nextCatering.deliveryDateISO)}
              </p>
              <p className={styles.opsCateringDate}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                {new Date(nextCatering.deliveryDateISO + "T00:00:00").toLocaleDateString("en-AU", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                })}
              </p>
            </>
          ) : (
            <p className={styles.opsSub}>No upcoming orders</p>
          )}
          <p className={styles.opsSub}>
            This Week<br />
            <strong>{weekCateringCount ?? "—"} Orders</strong>
          </p>
          <div className={styles.opsDivider} />
          <a href="/operations/catering-orders" className={styles.opsView}>
            View <span aria-hidden="true">→</span>
          </a>
        </section>
      </div>

      {/* WEEKLY PROGRESS */}
      <section className={styles.card}>
        <p className={styles.cardLabel}>WEEKLY PROGRESS</p>
        <p className={`${styles.weeklyAmount} ${weeklyProgress === null ? styles.salesLoading : ""}`}>
          {weeklyProgress === null ? "—" : fmt(weeklyProgress)}&nbsp;
          <span className={styles.weeklyTarget}>/ {fmt(WEEKLY_TARGET)}</span>
        </p>
        <Progress value={weeklyProgress ?? 0} max={WEEKLY_TARGET} />
      </section>

      {/* STATS — 하나의 카드, 세로 구분선 */}
      <section className={styles.statsCard}>
        <div className={styles.statCol}>
          <p className={styles.statLabel}>PEAK HOUR TODAY</p>
          <p className={`${styles.statValueWarm} ${peakHour === null ? styles.salesLoading : ""}`}>
            {peakHour ?? "—"}
          </p>
          <div className={styles.statDivider} />
          <p className={styles.statSubValue}>
            {peakHourOrders !== null && peakHourOrders > 0 ? `${peakHourOrders} orders` : "—"}
          </p>
        </div>

        <div className={styles.statColDivider} />

        <div className={styles.statCol}>
          <p className={styles.statLabel}>AVG SPEND PER TABLE</p>
          <p className={`${styles.statValue} ${avgSpendPerTable === null ? styles.salesLoading : ""}`}>
            {isRangeMode
              ? (rangeStats ? fmt(rangeStats.avgSpendPerTable) : "—")
              : (avgSpendPerTable === null ? "—" : fmt(avgSpendPerTable))}
          </p>
          <div className={styles.statDivider} />
          <p className={styles.statSub}>vs yesterday</p>
          {avgSpendChange !== null && (
            <p className={avgSpendChange >= 0 ? styles.statSubPos : styles.statSubNeg}>
              {avgSpendChange >= 0 ? "+" : ""}{fmt(avgSpendChange)}&nbsp;{avgSpendChange >= 0 ? "↗" : "↘"}
            </p>
          )}
        </div>

        <div className={styles.statColDivider} />

        <div className={styles.statCol}>
          <p className={styles.statLabel}>TRANSACTIONS</p>
          <p className={`${styles.statValue} ${transactions === null ? styles.salesLoading : ""}`}>
            {isRangeMode
              ? (rangeStats ? rangeStats.transactions : "—")
              : (transactions ?? "—")}
          </p>
          <div className={styles.statDivider} />
          <p className={styles.statSub}>vs yesterday</p>
          {transactionsChange !== null && (
            <p className={transactionsChange >= 0 ? styles.statSubPos : styles.statSubNeg}>
              {transactionsChange >= 0 ? "+" : ""}{transactionsChange}&nbsp;{transactionsChange >= 0 ? "↗" : "↘"}
            </p>
          )}
        </div>
      </section>

      {/* BEST SELLERS */}
      <section className={styles.card}>
        <p className={styles.cardLabel}>BEST SELLER {isRangeMode ? "THIS RANGE" : "TODAY"}</p>
        {(() => {
          const sellers = isRangeMode ? (rangeStats?.bestSellers ?? []) : bestSellers;
          const loading = isRangeMode ? rangeLoading : sellers.length === 0;
          if (loading || sellers.length === 0) return (
            <p className={`${styles.statSub} ${styles.salesLoading}`}>
              {isRangeMode && rangeLoading ? "Loading…" : "No data yet"}
            </p>
          );
          return (
            <ul className={styles.sellerList}>
              {sellers.map((item, i) => (
                <li key={item.name} className={styles.sellerItem}>
                  <span className={styles.sellerRank}>{i + 1}</span>
                  <span className={styles.sellerName}>{item.name}</span>
                  <span className={styles.sellerSales}>{fmt(item.sales)}</span>
                </li>
              ))}
            </ul>
          );
        })()}
      </section>

    </div>
  );
}
