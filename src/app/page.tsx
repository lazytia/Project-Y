"use client";

import { useState, useEffect, useCallback } from "react";
import styles from "./page.module.css";

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
  lunchPax: 42,
  lunchStaff: 5,
  dinnerPax: 58,
  dinnerStaff: 6,
  weeklyProgress: 17_850,
  peakHour: "12:30 PM",
  projectedTables: 18,
  avgSpendPerTable: 68,
  avgSpendChange: 4,
  transactions: 128,
  transactionsChange: 12,
  bestSellers: [
    { name: "Chicken Katsu Bento", sales: 1_350 },
    { name: "Wagyu Don", sales: 1_180 },
    { name: "Salmon Aburi Roll", sales: 980 },
  ],
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
  const todayDow = new Date().getDay();
  const dailyTarget = DAILY_TARGETS[todayDow];

  const [stats, setStats] = useState<{
    todaySales: number;
    transactions: number;
    transactionsChange: number;
    avgSpendPerTable: number;
    avgSpendChange: number;
    peakHour: string | null;
    peakHourOrders: number;
    bestSellers: { name: string; sales: number; quantity: number }[];
  } | null>(null);
  const [statsError, setStatsError] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/square/today-stats");
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

  useEffect(() => {
    fetchStats();
    const id = setInterval(fetchStats, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchStats]);

  const { lunchPax, lunchStaff, dinnerPax, dinnerStaff, weeklyProgress } = mock;

  const todaySales     = stats?.todaySales ?? null;
  const transactions   = stats?.transactions ?? null;
  const transactionsChange = stats?.transactionsChange ?? null;
  const avgSpendPerTable   = stats?.avgSpendPerTable ?? null;
  const avgSpendChange     = stats?.avgSpendChange ?? null;
  const peakHour           = stats?.peakHour ?? null;
  const peakHourOrders     = stats?.peakHourOrders ?? null;
  const bestSellers        = stats?.bestSellers ?? [];
  const projectedTables    = mock.projectedTables;

  return (
    <div className={styles.page}>

      {/* TODAY SALES */}
      <section className={styles.card}>
        <div className={styles.cardTopRow}>
          <p className={styles.cardLabel}>TODAY SALES</p>
          {lastUpdated && (
            <p className={styles.lastUpdated}>
              {lastUpdated.toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
              })} 업데이트
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
      </section>

      {/* LUNCH / DINNER */}
      <div className={styles.splitRow}>
        <section className={styles.splitCard}>
          <p className={styles.splitLabel}>☀ LUNCH</p>
          <p className={styles.splitPax}>
            {lunchPax} <span className={styles.splitUnit}>PAX</span>
          </p>
          <p className={styles.splitStaff}>
            👥 {lunchStaff} <span className={styles.splitUnit}>STAFF</span>
          </p>
        </section>
        <section className={styles.splitCard}>
          <p className={styles.splitLabel}>🌙 DINNER</p>
          <p className={styles.splitPax}>
            {dinnerPax} <span className={styles.splitUnit}>PAX</span>
          </p>
          <p className={styles.splitStaff}>
            👥 {dinnerStaff} <span className={styles.splitUnit}>STAFF</span>
          </p>
        </section>
      </div>

      {/* WEEKLY PROGRESS */}
      <section className={styles.card}>
        <p className={styles.cardLabel}>WEEKLY PROGRESS</p>
        <p className={styles.weeklyAmount}>
          {fmt(weeklyProgress)}&nbsp;
          <span className={styles.weeklyTarget}>/ {fmt(WEEKLY_TARGET)}</span>
        </p>
        <Progress value={weeklyProgress} max={WEEKLY_TARGET} />
      </section>

      {/* STATS */}
      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <p className={styles.statLabel}>PEAK HOUR TODAY</p>
          <p className={`${styles.statValueWarm} ${peakHour === null ? styles.salesLoading : ""}`}>
            {peakHour ?? "—"}
          </p>
          {peakHourOrders !== null && peakHourOrders > 0 && (
            <p className={styles.statSubValue}>{peakHourOrders} orders</p>
          )}
        </div>
        <div className={styles.statCard}>
          <p className={styles.statLabel}>AVG SPEND PER TABLE</p>
          <p className={`${styles.statValue} ${avgSpendPerTable === null ? styles.salesLoading : ""}`}>
            {avgSpendPerTable === null ? "—" : fmt(avgSpendPerTable)}
          </p>
          <p className={styles.statSub}>vs yesterday</p>
          {avgSpendChange !== null && (
            <p className={avgSpendChange >= 0 ? styles.statSubPos : styles.statSubNeg}>
              {avgSpendChange >= 0 ? "+" : ""}{fmt(avgSpendChange)} {avgSpendChange >= 0 ? "↗" : "↘"}
            </p>
          )}
        </div>
        <div className={styles.statCard}>
          <p className={styles.statLabel}>TRANSACTIONS</p>
          <p className={`${styles.statValue} ${transactions === null ? styles.salesLoading : ""}`}>
            {transactions ?? "—"}
          </p>
          <p className={styles.statSub}>vs yesterday</p>
          {transactionsChange !== null && (
            <p className={transactionsChange >= 0 ? styles.statSubPos : styles.statSubNeg}>
              {transactionsChange >= 0 ? "+" : ""}{transactionsChange} {transactionsChange >= 0 ? "↗" : "↘"}
            </p>
          )}
        </div>
      </div>

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
