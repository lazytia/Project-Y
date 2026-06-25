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
  const todayKey = useMemo(sydneyTodayKey, []);
  const [selectedDate, setSelectedDate] = useState<string>(todayKey);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [rangeDates, setRangeDates] = useState<{ start: string; end: string } | null>(null);
  const isRangeMode = rangeDates !== null;
  const isToday = !isRangeMode && selectedDate === todayKey;
  const dailyTarget = DAILY_TARGETS[dowOfDateKey(selectedDate)];

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

  // Reset displayed values on date change so we don't briefly show stale numbers.
  useEffect(() => {
    setStats(null);
    setReservations(null);
    setLastUpdated(null);
    fetchStats(selectedDate);
    fetchReservations(selectedDate);
    // Live poll only when viewing today — historical days don't change.
    if (!isToday) return;
    const id1 = setInterval(() => fetchStats(selectedDate), POLL_INTERVAL_MS);
    const id2 = setInterval(() => fetchReservations(selectedDate), POLL_INTERVAL_MS);
    return () => {
      clearInterval(id1);
      clearInterval(id2);
    };
  }, [selectedDate, isToday, fetchStats, fetchReservations]);

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

  const lunchPax      = resCounts?.lunchPax ?? null;
  const lunchBookings = resCounts?.lunchBookings ?? null;
  const dinnerPax     = resCounts?.dinnerPax ?? null;
  const dinnerBookings = resCounts?.dinnerBookings ?? null;

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

      {/* LUNCH / DINNER */}
      <div className={styles.splitRow}>
        <section className={styles.splitCard}>
          <p className={styles.splitLabel}>☀ LUNCH</p>
          <p className={`${styles.splitPax} ${lunchPax === null ? styles.salesLoading : ""}`}>
            {lunchPax ?? "—"} <span className={styles.splitUnit}>PAX</span>
          </p>
          <p className={styles.splitStaff}>
            📋 {lunchBookings ?? "—"} <span className={styles.splitUnit}>BOOKINGS</span>
          </p>
        </section>
        <section className={styles.splitCard}>
          <p className={styles.splitLabel}>🌙 DINNER</p>
          <p className={`${styles.splitPax} ${dinnerPax === null ? styles.salesLoading : ""}`}>
            {dinnerPax ?? "—"} <span className={styles.splitUnit}>PAX</span>
          </p>
          <p className={styles.splitStaff}>
            📋 {dinnerBookings ?? "—"} <span className={styles.splitUnit}>BOOKINGS</span>
          </p>
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
