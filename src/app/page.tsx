"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import styles from "./page.module.css";

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
  const pct = Math.min(Math.round((value / max) * 100), 100);
  return (
    <div className={styles.progressRow}>
      <div className={styles.progressTrack}>
        <div className={styles.progressFill} style={{ width: `${pct}%` }} />
      </div>
      <span className={styles.progressPct}>{pct}%</span>
    </div>
  );
}

export default function DashboardPage() {
  const todayKey = useMemo(sydneyTodayKey, []);
  const [selectedDate, setSelectedDate] = useState<string>(todayKey);
  const isToday = selectedDate === todayKey;
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
  const [counts, setCounts] = useState<{
    lunchPax: number;
    dinnerPax: number;
    lunchStaff: number;
    dinnerStaff: number;
  } | null>(null);
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

  const fetchCounts = useCallback(async (dateKey: string) => {
    try {
      const url = `/api/system-yurica/today-counts?date=${encodeURIComponent(dateKey)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setCounts(await res.json());
    } catch (err) {
      console.error("[system_yurica] fetch error:", err);
    }
  }, []);

  // Reset displayed values on date change so we don't briefly show stale numbers.
  useEffect(() => {
    setStats(null);
    setCounts(null);
    setLastUpdated(null);
    fetchStats(selectedDate);
    fetchCounts(selectedDate);
    // Live poll only when viewing today — historical days don't change.
    if (!isToday) return;
    const id1 = setInterval(() => fetchStats(selectedDate), POLL_INTERVAL_MS);
    const id2 = setInterval(() => fetchCounts(selectedDate), POLL_INTERVAL_MS);
    return () => {
      clearInterval(id1);
      clearInterval(id2);
    };
  }, [selectedDate, isToday, fetchStats, fetchCounts]);

  const lunchPax    = counts?.lunchPax ?? null;
  const dinnerPax   = counts?.dinnerPax ?? null;
  const lunchStaff  = counts?.lunchStaff ?? null;
  const dinnerStaff = counts?.dinnerStaff ?? null;

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
          aria-label="Previous day"
        >‹</button>
        <div className={styles.dateCenter}>
          <input
            type="date"
            value={selectedDate}
            max={todayKey}
            onChange={(e) => {
              const v = e.target.value;
              if (v && v <= todayKey) setSelectedDate(v);
            }}
            className={styles.dateInput}
            aria-label="Select date"
          />
          <span className={styles.dateLabel}>{formatDateLabel(selectedDate)}</span>
          {!isToday && (
            <button
              type="button"
              onClick={goToToday}
              className={styles.todayBtn}
            >
              Today
            </button>
          )}
        </div>
        <button
          type="button"
          className={styles.dateNavBtn}
          onClick={goNext}
          disabled={isToday}
          aria-label="Next day"
        >›</button>
      </section>

      {/* TODAY SALES — RESTAURANT / PLATTER 포함 */}
      <section className={styles.card}>
        <div className={styles.cardTopRow}>
          <p className={styles.cardLabel}>TODAY SALES</p>
          {lastUpdated && (
            <p className={styles.lastUpdated}>
              {lastUpdated.toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
              })} updated
            </p>
          )}
          {statsError && (
            <p className={styles.errorBadge}>Square 연결 오류</p>
          )}
        </div>
        <p className={`${styles.salesAmount} ${todaySales === null ? styles.salesLoading : ""}`}>
          {todaySales === null ? "—" : fmt(todaySales)}
        </p>
        <p className={styles.targetLabel}>
          Target&nbsp;&nbsp;<strong>{fmt(dailyTarget)}</strong>
        </p>
        <Progress value={todaySales ?? 0} max={dailyTarget} />

        {/* 카드 내부 구분선 + 레스토랑/플래터 분리 */}
        <div className={styles.salesBreakRow}>
          <div className={styles.salesBreakItem}>
            <p className={styles.cardLabel}>RESTAURANT SALES</p>
            <p className={`${styles.salesBreakAmount} ${restaurantSales === null ? styles.salesLoading : ""}`}>
              {restaurantSales === null ? "—" : fmt(restaurantSales)}
            </p>
          </div>
          <div className={styles.salesBreakDivider} />
          <div className={styles.salesBreakItem}>
            <p className={styles.cardLabel}>PLATTER SALES</p>
            <p className={`${styles.salesBreakAmount} ${platterSales === null ? styles.salesLoading : ""}`}>
              {platterSales === null ? "—" : fmt(platterSales)}
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
            👥 {lunchStaff ?? "—"} <span className={styles.splitUnit}>STAFF</span>
          </p>
        </section>
        <section className={styles.splitCard}>
          <p className={styles.splitLabel}>🌙 DINNER</p>
          <p className={`${styles.splitPax} ${dinnerPax === null ? styles.salesLoading : ""}`}>
            {dinnerPax ?? "—"} <span className={styles.splitUnit}>PAX</span>
          </p>
          <p className={styles.splitStaff}>
            👥 {dinnerStaff ?? "—"} <span className={styles.splitUnit}>STAFF</span>
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
            {avgSpendPerTable === null ? "—" : fmt(avgSpendPerTable)}
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
            {transactions ?? "—"}
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
        <p className={styles.cardLabel}>BEST SELLER TODAY</p>
        {bestSellers.length === 0 ? (
          <p className={`${styles.statSub} ${styles.salesLoading}`}>데이터 로딩 중…</p>
        ) : (
          <ul className={styles.sellerList}>
            {bestSellers.map((item, i) => (
              <li key={item.name} className={styles.sellerItem}>
                <span className={styles.sellerRank}>{i + 1}</span>
                <span className={styles.sellerName}>{item.name}</span>
                <span className={styles.sellerSales}>{fmt(item.sales)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

    </div>
  );
}
