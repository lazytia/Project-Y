"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import styles from "./page.module.css";
import Splash from "@/components/Splash";

// Manager dashboard is only rendered for non-strict-owner managers/chefs, so
// owners (the majority) don't need it in their initial bundle. Calendar
// picker is only mounted when the user actually taps the date pill.
const ManagerDashboard = dynamic(() => import("@/components/ManagerDashboard"), {
  loading: () => <Splash label="Loading…" />,
});
const CalendarPicker = dynamic(() => import("@/components/CalendarPicker"), {
  ssr: false,
});
// Attention card sits above the TODAY tile — code-split so it doesn't
// bloat the manager/chef dashboards (which don't render it).
const DashboardAttention = dynamic(() => import("@/components/DashboardAttention"), {
  ssr: false,
});
import { useAuth } from "@/components/AuthProvider";
import { isOwner, isStrictOwner, isChef } from "@/lib/permissions";
import {
  type Reservation,
  fetchReservationsForDate,
  serviceFor,
} from "@/lib/reservations";
import {
  type CateringOrder,
  fetchCateringOrders,
  dCountdownLabel,
} from "@/lib/catering-orders";

const SYDNEY_TZ = "Australia/Sydney";
const WEEKLY_TARGET = 30_000;
const PAYROLL_TARGET_PCT = 25;

/** Weekly-sales-derived daily targets (0=Sun … 6=Sat). Sunday is closed. */
const DAILY_TARGETS: Record<number, number> = {
  0: 0,
  1: 3_800,
  2: 5_200,
  3: 5_500,
  4: 6_500,
  5: 6_000,
  6: 3_000,
};

const POLL_INTERVAL_MS = 30_000;

/**
 * sessionStorage-backed cache for the owner dashboard. Keyed by date so
 * flipping days is instant and returning to today skips the fetch-flash.
 * Every field is optional — a stale/missing value just means "we'll show
 * "—" until the live fetch fills it".
 */
type DashCache = Partial<{
  todaySales: number;
  restaurantSales: number;
  platterSales: number;
  weeklyProgress: number;
  bestSellers: { name: string; sales: number; quantity: number }[];
  savedDaySales: number;
  lunchPax: number;
  dinnerPax: number;
  lunchStaff: number;
  dinnerStaff: number;
  prevWeekSales: number;
  weekSalesDoc: number;
  weeklyPayroll: number;
  reviewNote: string;
  nextCateringISO: string;
  weekCateringCount: number;
}>;

const DASH_CACHE_KEY = "y.ownerDash";

function readDashCache(dateKey: string): DashCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(`${DASH_CACHE_KEY}.${dateKey}`);
    return raw ? (JSON.parse(raw) as DashCache) : null;
  } catch {
    return null;
  }
}

function writeDashCache(dateKey: string, patch: DashCache) {
  if (typeof window === "undefined") return;
  try {
    const key = `${DASH_CACHE_KEY}.${dateKey}`;
    const prev = readDashCache(dateKey) ?? {};
    sessionStorage.setItem(key, JSON.stringify({ ...prev, ...patch }));
  } catch {
    /* quota / private mode — ignore */
  }
}

function sydneyTodayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: SYDNEY_TZ });
}

function dowOfDateKey(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

function isoMondayOf(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = (dt.getUTCDay() + 6) % 7; // Mon = 0
  dt.setUTCDate(dt.getUTCDate() - dow);
  return dt.toISOString().slice(0, 10);
}

function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function formatHeaderDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatWeekRange(mondayISO: string): string {
  const sunday = addDaysISO(mondayISO, 6);
  const [my, mm, md] = mondayISO.split("-").map(Number);
  const [sy, sm, sd] = sunday.split("-").map(Number);
  const monShort = new Date(Date.UTC(my, mm - 1, md, 12));
  const sunShort = new Date(Date.UTC(sy, sm - 1, sd, 12));
  const monLabel = monShort.getUTCMonth() === sunShort.getUTCMonth() ? String(md) : `${md} ${monShort.toLocaleDateString("en-AU", { month: "short", timeZone: "UTC" })}`;
  const sunLabel = sunShort.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `${monLabel} – ${sunLabel}`;
}

function fmtCurrency(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtCurrencyWhole(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function Progress({ value, max, pctRight, tone = "orange" }: { value: number; max: number; pctRight?: boolean; tone?: "orange" | "onDark" }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const fillPct = Math.min(pct, 100);
  const trackClass = tone === "onDark" ? `${styles.progressTrack} ${styles.progressTrackOnDark}` : styles.progressTrack;
  return (
    <div className={styles.progressRow}>
      <div className={trackClass}>
        <div className={styles.progressFill} style={{ width: `${fillPct}%` }} />
      </div>
      {pctRight && <span className={styles.progressPct}>{pct}%</span>}
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const userIsChef = isChef(user);
  const userIsManager = (isOwner(user) && !isStrictOwner(user)) || userIsChef;
  if (userIsManager) {
    return (
      <ManagerDashboard
        hideAttention={userIsChef}
        roleLabel={userIsChef ? "Head Chef" : "Store Manager"}
      />
    );
  }
  return <OwnerDashboard />;
}

type Stats = {
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
};

function OwnerDashboard() {
  const { user } = useAuth();
  const [todayKey, setTodayKey] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    const key = sydneyTodayKey();
    setTodayKey(key);
    setSelectedDate(key);
  }, []);

  const isToday = !!selectedDate && selectedDate === todayKey;
  const dailyTarget = selectedDate ? DAILY_TARGETS[dowOfDateKey(selectedDate)] ?? 0 : 0;
  const weekMondayISO = selectedDate ? isoMondayOf(selectedDate) : "";
  const prevMondayISO = weekMondayISO ? addDaysISO(weekMondayISO, -7) : "";

  const [stats, setStats] = useState<Stats | null>(null);
  const [statsError, setStatsError] = useState(false);
  // Firestore snapshot of the day's gross sales — shown instantly on load
  // (so past dates don't need to wait for Square), and refreshed to
  // Firestore whenever the live Square call returns a fresh number.
  const [savedDaySales, setSavedDaySales] = useState<number | null>(null);
  const [reservations, setReservations] = useState<Reservation[] | null>(null);
  const [cateringOrders, setCateringOrders] = useState<CateringOrder[] | null>(null);
  const [lunchStaff, setLunchStaff] = useState<number | null>(null);
  const [dinnerStaff, setDinnerStaff] = useState<number | null>(null);
  const [prevWeekSales, setPrevWeekSales] = useState<number | null>(null);
  // Weekly sales for the SELECTED week. Read from sales_weekly Firestore so
  // past weeks show their real total; the live Square API only knows the
  // current week's running progress.
  const [weekSalesDoc, setWeekSalesDoc] = useState<number | null>(null);
  const [weeklyPayroll, setWeeklyPayroll] = useState<number | null>(null);
  const [reviewNote, setReviewNote] = useState<string>("");
  const [reviewEditing, setReviewEditing] = useState(false);
  const [reviewDraft, setReviewDraft] = useState("");
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [dataLoading, setDataLoading] = useState(true);

  const fetchStats = useCallback(async (dateKey: string) => {
    try {
      const res = await fetch(`/api/square/today-stats?date=${encodeURIComponent(dateKey)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Stats;
      setStats(data);
      setStatsError(false);
      setLastUpdated(new Date());
      writeDashCache(dateKey, {
        todaySales: data.todaySales,
        restaurantSales: data.restaurantSales,
        platterSales: data.platterSales,
        weeklyProgress: data.weeklyProgress,
        bestSellers: data.bestSellers,
      });
      // Persist the day's gross sales to Firestore so past days keep
      // their number even if Square becomes unreachable later. Fire-
      // and-forget — a failed write must not tank the render path.
      if (typeof data.todaySales === "number") {
        setDoc(
          doc(getDb(), "sales_daily", dateKey),
          {
            dateISO: dateKey,
            grossSales: data.todaySales,
            source: "dashboard-snapshot",
            syncedAt: serverTimestamp(),
          },
          { merge: true },
        ).catch((err) => console.error("[sales_daily] snapshot write failed:", err));
        setSavedDaySales(data.todaySales);
        writeDashCache(dateKey, { savedDaySales: data.todaySales });
      }
    } catch (err) {
      console.error("[Square] fetch error:", err);
      setStatsError(true);
    }
  }, []);

  const fetchSavedDaySales = useCallback(async (dateKey: string) => {
    try {
      const snap = await getDoc(doc(getDb(), "sales_daily", dateKey));
      const data = snap.exists() ? (snap.data() as { grossSales?: number }) : null;
      const v = typeof data?.grossSales === "number" ? data.grossSales : null;
      setSavedDaySales(v);
      if (v !== null) writeDashCache(dateKey, { savedDaySales: v });
    } catch {
      /* keep previous value on failure */
    }
  }, []);

  const fetchReservations = useCallback(async (dateKey: string) => {
    try {
      const data = await fetchReservationsForDate(user, dateKey, "northsydney");
      setReservations(data);
      const active = data.filter((r) => r.status !== "cancelled" && r.status !== "no-show");
      const lunchPax = active
        .filter((r) => serviceFor(r.time) === "LUNCH")
        .reduce((s, r) => s + r.count, 0);
      const dinnerPax = active
        .filter((r) => serviceFor(r.time) === "DINNER")
        .reduce((s, r) => s + r.count, 0);
      writeDashCache(dateKey, { lunchPax, dinnerPax });
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

  const fetchRosterStaff = useCallback(async (dateKey: string) => {
    try {
      const weekKey = isoMondayOf(dateKey);
      const rSnap = await getDoc(doc(getDb(), "rosters_published", weekKey));
      if (!rSnap.exists()) {
        setLunchStaff(0);
        setDinnerStaff(0);
        writeDashCache(dateKey, { lunchStaff: 0, dinnerStaff: 0 });
        return;
      }
      const rData = rSnap.data() as { assignments?: Record<string, Record<string, Record<string, string>>> };
      const dayAssign = rData.assignments?.[dateKey] ?? {};
      const lunch = new Set<string>();
      const dinner = new Set<string>();
      for (const [meal, uids] of Object.entries(dayAssign)) {
        const key = meal.toLowerCase();
        const set = key.includes("dinner") ? dinner : lunch;
        for (const uid of Object.keys(uids)) set.add(uid);
      }
      setLunchStaff(lunch.size);
      setDinnerStaff(dinner.size);
      writeDashCache(dateKey, { lunchStaff: lunch.size, dinnerStaff: dinner.size });
    } catch (err) {
      console.error("[roster] fetch error:", err);
    }
  }, []);

  const fetchPrevWeekSales = useCallback(async (prevMonday: string, dateKey: string) => {
    if (!prevMonday) return;
    try {
      const snap = await getDoc(doc(getDb(), "sales_weekly", prevMonday));
      const data = snap.exists() ? snap.data() as { grossSales?: number } : null;
      const v = typeof data?.grossSales === "number" ? data.grossSales : null;
      setPrevWeekSales(v);
      if (v !== null) writeDashCache(dateKey, { prevWeekSales: v });
    } catch {
      /* keep previous */
    }
  }, []);

  const fetchWeekSales = useCallback(async (monday: string, dateKey: string) => {
    if (!monday) return;
    try {
      const snap = await getDoc(doc(getDb(), "sales_weekly", monday));
      const data = snap.exists() ? snap.data() as { grossSales?: number } : null;
      const v = typeof data?.grossSales === "number" ? data.grossSales : null;
      setWeekSalesDoc(v);
      if (v !== null) writeDashCache(dateKey, { weekSalesDoc: v });
    } catch {
      /* keep previous */
    }
  }, []);

  const fetchWeeklyPayroll = useCallback(async (monday: string, dateKey: string) => {
    if (!monday) return;
    try {
      const snap = await getDoc(doc(getDb(), "payroll_weekly", monday));
      const data = snap.exists() ? snap.data() as { totalIncSuper?: number; gross?: number; super?: number } : null;
      if (!data) { setWeeklyPayroll(null); return; }
      const total = typeof data.totalIncSuper === "number"
        ? data.totalIncSuper
        : (data.gross ?? 0) + (data.super ?? 0);
      const v = total || null;
      setWeeklyPayroll(v);
      if (v !== null) writeDashCache(dateKey, { weeklyPayroll: v });
    } catch {
      /* keep previous */
    }
  }, []);

  const fetchReviewNote = useCallback(async (dateKey: string) => {
    try {
      const snap = await getDoc(doc(getDb(), "sales_reviews", dateKey));
      const text = snap.exists() ? (snap.data() as { text?: string }).text ?? "" : "";
      setReviewNote(text);
      setReviewDraft(text);
      writeDashCache(dateKey, { reviewNote: text });
    } catch {
      setReviewNote("");
      setReviewDraft("");
    }
  }, []);

  function hydrateFromCache(dateKey: string) {
    const cached = readDashCache(dateKey);
    if (!cached) return;
    if (
      typeof cached.todaySales === "number" ||
      typeof cached.restaurantSales === "number" ||
      typeof cached.platterSales === "number" ||
      typeof cached.weeklyProgress === "number"
    ) {
      setStats((prev) => ({
        todaySales: cached.todaySales ?? prev?.todaySales ?? 0,
        transactions: prev?.transactions ?? 0,
        transactionsChange: prev?.transactionsChange ?? 0,
        avgSpendPerTable: prev?.avgSpendPerTable ?? 0,
        avgSpendChange: prev?.avgSpendChange ?? 0,
        restaurantSales: cached.restaurantSales ?? prev?.restaurantSales ?? 0,
        platterSales: cached.platterSales ?? prev?.platterSales ?? 0,
        weeklyProgress: cached.weeklyProgress ?? prev?.weeklyProgress ?? 0,
        peakHour: prev?.peakHour ?? null,
        peakHourOrders: prev?.peakHourOrders ?? 0,
        bestSellers: cached.bestSellers ?? prev?.bestSellers ?? [],
      }));
    }
    if (typeof cached.savedDaySales === "number") setSavedDaySales(cached.savedDaySales);
    if (typeof cached.lunchStaff === "number") setLunchStaff(cached.lunchStaff);
    if (typeof cached.dinnerStaff === "number") setDinnerStaff(cached.dinnerStaff);
    if (typeof cached.prevWeekSales === "number") setPrevWeekSales(cached.prevWeekSales);
    if (typeof cached.weekSalesDoc === "number") setWeekSalesDoc(cached.weekSalesDoc);
    if (typeof cached.weeklyPayroll === "number") setWeeklyPayroll(cached.weeklyPayroll);
    if (typeof cached.reviewNote === "string") {
      setReviewNote(cached.reviewNote);
      setReviewDraft(cached.reviewNote);
    }
  }

  // Load every metric in parallel, then reveal the dashboard. Polling
  // refreshes happen in the background without re-showing the splash.
  useEffect(() => {
    if (!selectedDate) return;
    let cancelled = false;

    (async () => {
      setDataLoading(true);
      hydrateFromCache(selectedDate);
      await Promise.allSettled([
        fetchSavedDaySales(selectedDate),
        fetchStats(selectedDate),
        fetchReservations(selectedDate),
        fetchCatering(),
        fetchRosterStaff(selectedDate),
        fetchPrevWeekSales(prevMondayISO, selectedDate),
        fetchWeekSales(weekMondayISO, selectedDate),
        fetchWeeklyPayroll(weekMondayISO, selectedDate),
        fetchReviewNote(selectedDate),
      ]);
      if (!cancelled) setDataLoading(false);
    })();

    return () => { cancelled = true; };
  }, [selectedDate, prevMondayISO, weekMondayISO, fetchStats, fetchSavedDaySales, fetchReservations, fetchCatering, fetchRosterStaff, fetchPrevWeekSales, fetchWeekSales, fetchWeeklyPayroll, fetchReviewNote]);

  useEffect(() => {
    if (!selectedDate || !isToday) return;
    const id1 = setInterval(() => fetchStats(selectedDate), POLL_INTERVAL_MS);
    const id2 = setInterval(() => fetchReservations(selectedDate), POLL_INTERVAL_MS);
    return () => { clearInterval(id1); clearInterval(id2); };
  }, [selectedDate, isToday, fetchStats, fetchReservations]);

  const resCounts = useMemo(() => {
    if (!reservations) return null;
    const active = reservations.filter((r) => r.status !== "cancelled" && r.status !== "no-show");
    const lunch = active.filter((r) => serviceFor(r.time) === "LUNCH");
    const dinner = active.filter((r) => serviceFor(r.time) === "DINNER");
    return {
      lunchPax: lunch.reduce((s, r) => s + r.count, 0),
      dinnerPax: dinner.reduce((s, r) => s + r.count, 0),
    };
  }, [reservations]);

  const nextCatering = useMemo(() => {
    if (!cateringOrders || !todayKey) return null;
    const upcoming = cateringOrders
      .filter((o) => (o.status === "CONFIRMED" || o.status === "PENDING") && o.deliveryDateISO >= todayKey)
      .sort((a, b) => a.deliveryDateISO.localeCompare(b.deliveryDateISO));
    return upcoming[0] ?? null;
  }, [cateringOrders, todayKey]);

  const weekCateringCount = useMemo(() => {
    if (!cateringOrders || !weekMondayISO) return null;
    const end = addDaysISO(weekMondayISO, 6);
    return cateringOrders.filter(
      (o) => o.deliveryDateISO >= weekMondayISO && o.deliveryDateISO <= end && o.status !== "CANCELLED",
    ).length;
  }, [cateringOrders, weekMondayISO]);

  // Prefer the Firestore snapshot (works for past weeks); fall back to the
  // live Square progress figure for the current in-progress week.
  const weeklySales = weekSalesDoc ?? stats?.weeklyProgress ?? null;
  const vsLastWeekPct = useMemo(() => {
    if (weeklySales === null || prevWeekSales === null || !prevWeekSales) return null;
    return ((weeklySales - prevWeekSales) / prevWeekSales) * 100;
  }, [weeklySales, prevWeekSales]);

  const payrollPct = useMemo(() => {
    if (weeklyPayroll === null || weeklySales === null || !weeklySales) return null;
    return (weeklyPayroll / weeklySales) * 100;
  }, [weeklyPayroll, weeklySales]);

  const payrollOnTarget = payrollPct !== null && payrollPct <= PAYROLL_TARGET_PCT;

  const bestSellers = (stats?.bestSellers ?? []).slice(0, 3);

  const saveReview = async () => {
    if (reviewSaving) return;
    setReviewSaving(true);
    setReviewError(null);
    try {
      await setDoc(
        doc(getDb(), "sales_reviews", selectedDate),
        { text: reviewDraft, updatedAt: serverTimestamp() },
        { merge: true },
      );
      setReviewNote(reviewDraft);
      setReviewEditing(false);
    } catch (err) {
      console.error("[sales_reviews] save failed:", err);
      setReviewError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setReviewSaving(false);
    }
  };

  const cancelReview = () => {
    setReviewDraft(reviewNote);
    setReviewEditing(false);
  };

  const deleteReview = async () => {
    if (reviewSaving) return;
    if (!window.confirm("Delete this day's sales review?")) return;
    setReviewSaving(true);
    setReviewError(null);
    try {
      await deleteDoc(doc(getDb(), "sales_reviews", selectedDate));
      setReviewNote("");
      setReviewDraft("");
      setReviewEditing(false);
    } catch (err) {
      console.error("[sales_reviews] delete failed:", err);
      setReviewError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setReviewSaving(false);
    }
  };

  if (dataLoading || !selectedDate) {
    return <Splash label="Loading dashboard…" />;
  }

  return (
    <div className={styles.page}>
      {/* HEADER */}
      <header className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Dashboard</h1>
          <p className={styles.pageSubtitle}>Owner Overview</p>
        </div>
        <button
          type="button"
          className={styles.datePill}
          onClick={() => setCalendarOpen(true)}
          aria-label="Open calendar"
        >
          <span className={styles.datePillIcon} aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </span>
          <span className={styles.datePillLabel}>
            {selectedDate ? formatHeaderDate(selectedDate) : "—"}
          </span>
          <span className={styles.datePillChevron} aria-hidden="true">▾</span>
        </button>
      </header>

      {calendarOpen && (
        <CalendarPicker
          value={selectedDate}
          maxDate={todayKey}
          singleOnly
          onChange={(d) => setSelectedDate(d)}
          onRangeChange={() => { /* range mode disabled via singleOnly */ }}
          onClose={() => setCalendarOpen(false)}
        />
      )}

      {/* ATTENTION — today's new items across catering, sold-out, new
          hires, notice given, HR notes, and cash payments. Rows the owner
          hits Noted on disappear until tomorrow. */}
      <DashboardAttention />

      {/* TODAY */}
      <section className={styles.todayCard}>
        <div className={styles.todayHeader}>
          <span className={styles.sectionLabel}>TODAY</span>
          <Link href="/operations/reservations" className={styles.viewLink}>View</Link>
        </div>
        <div className={styles.todayBody}>
          <div className={styles.todayLeft}>
            <p className={styles.miniLabel}>TODAY SALES</p>
            {(() => {
              // Prefer the live Square figure when we have it; otherwise
              // fall back to whatever the Firestore snapshot holds so
              // past dates render immediately and don't go blank when
              // Square is unreachable.
              const shown = stats?.todaySales ?? savedDaySales;
              return (
                <>
                  <p className={`${styles.salesAmount} ${shown === null || shown === undefined ? styles.loading : ""}`}>
                    {typeof shown === "number" ? fmtCurrency(shown) : "—"}
                  </p>
                  <p className={styles.targetSub}>
                    Target <span className={styles.strong}>{fmtCurrencyWhole(dailyTarget)}</span>
                  </p>
                  <Progress value={typeof shown === "number" ? shown : 0} max={dailyTarget} pctRight />
                </>
              );
            })()}
          </div>
          <div className={styles.todayDivider} aria-hidden="true" />
          <div className={styles.todayRight}>
            <div className={styles.mealRow}>
              <span className={styles.mealIcon}>☀️</span>
              <div className={styles.mealCol}>
                <p className={styles.mealTitle}>LUNCH</p>
                <p className={styles.mealValue}>
                  {resCounts?.lunchPax ?? "—"} <span className={styles.mealUnit}>PAX</span>
                </p>
                <p className={styles.mealSub}>
                  <span aria-hidden="true">👥</span> {lunchStaff ?? "—"} STAFF
                </p>
              </div>
            </div>
            <div className={styles.mealRow}>
              <span className={styles.mealIcon}>🌙</span>
              <div className={styles.mealCol}>
                <p className={styles.mealTitle}>DINNER</p>
                <p className={styles.mealValue}>
                  {resCounts?.dinnerPax ?? "—"} <span className={styles.mealUnit}>PAX</span>
                </p>
                <p className={styles.mealSub}>
                  <span aria-hidden="true">👥</span> {dinnerStaff ?? "—"} STAFF
                </p>
              </div>
            </div>
          </div>
        </div>
        {statsError && <p className={styles.errorBadge}>Square 연결 오류</p>}
        {lastUpdated && !statsError && (
          <p className={styles.updatedTiny}>
            Updated {lastUpdated.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
          </p>
        )}
      </section>

      {/* THIS WEEK */}
      <section className={styles.weekCard}>
        <div className={styles.weekHeader}>
          <span className={styles.sectionLabelOnDark}>THIS WEEK</span>
          <span className={styles.weekRange}>{weekMondayISO ? formatWeekRange(weekMondayISO) : ""}</span>
        </div>
        <div className={styles.weekBody}>
          <div className={styles.weekLeft}>
            <p className={styles.miniLabelOnDark}>WEEKLY SALES</p>
            <p className={styles.weekAmount}>
              {weeklySales !== null ? fmtCurrency(weeklySales) : "—"}
            </p>
            <p className={styles.targetSubOnDark}>Target {fmtCurrencyWhole(WEEKLY_TARGET)}</p>
            <Progress value={weeklySales ?? 0} max={WEEKLY_TARGET} tone="onDark" />
            <p className={styles.weekVs}>
              vs last week{" "}
              {vsLastWeekPct !== null ? (
                <span className={vsLastWeekPct >= 0 ? styles.deltaPos : styles.deltaNeg}>
                  {vsLastWeekPct >= 0 ? "+" : ""}{vsLastWeekPct.toFixed(0)}% {vsLastWeekPct >= 0 ? "↑" : "↓"}
                </span>
              ) : "—"}
            </p>
          </div>
          <div className={styles.weekDivider} aria-hidden="true" />
          <div className={styles.weekRight}>
            <p className={styles.miniLabelOnDark}>PAYROLL %</p>
            <p className={styles.payrollPct}>
              {payrollPct !== null ? `${payrollPct.toFixed(1)}%` : "—"}
            </p>
            <p className={styles.targetSubOnDark}>Target {PAYROLL_TARGET_PCT}%</p>
            {payrollPct !== null && (
              <span className={payrollOnTarget ? styles.badgeOnTarget : styles.badgeOverTarget}>
                {payrollOnTarget ? "On target" : "Over Target"}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* CATERING ROW — whole card is a link to /operations/catering-orders */}
      <div className={styles.splitRow}>
        <Link href="/operations/catering-orders" className={styles.splitCard}>
          <p className={styles.miniLabel}>CATERING THIS WEEK</p>
          <div className={styles.splitBody}>
            <span className={styles.cateringIcon} aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </span>
            <p className={styles.cateringCount}>
              {weekCateringCount ?? "—"} <span className={styles.cateringUnit}>Orders</span>
            </p>
          </div>
        </Link>
        <Link href="/operations/catering-orders" className={styles.splitCard}>
          <div className={styles.splitCardHead}>
            <p className={styles.miniLabel}>NEXT CATERING</p>
            <span className={styles.splitCardView}>
              View <span aria-hidden="true">→</span>
            </span>
          </div>
          {nextCatering ? (
            <>
              <p className={styles.cateringCountdown}>{dCountdownLabel(nextCatering.deliveryDateISO)}</p>
              <p className={styles.cateringDate}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
            <p className={styles.mutedSmall}>No upcoming orders</p>
          )}
        </Link>
      </div>

      {/* TODAY'S SALES REVIEW */}
      <section className={styles.reviewCard}>
        <div className={styles.reviewHeader}>
          <p className={styles.sectionLabel}>TODAY&apos;S SALES REVIEW</p>
          {!reviewEditing && (
            <button
              type="button"
              className={styles.editBtn}
              onClick={() => { setReviewDraft(reviewNote); setReviewEditing(true); }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              Edit
            </button>
          )}
        </div>
        {reviewEditing ? (
          <>
            <textarea
              className={styles.reviewTextarea}
              value={reviewDraft}
              onChange={(e) => setReviewDraft(e.target.value)}
              placeholder="How did today go? Notes on service, weather, market news, things to watch…"
              rows={6}
              autoFocus
            />
            <div className={styles.reviewActions}>
              {reviewNote && (
                <button
                  type="button"
                  className={styles.btnDanger}
                  onClick={deleteReview}
                  disabled={reviewSaving}
                >
                  Delete
                </button>
              )}
              <div className={styles.reviewActionsRight}>
                <button type="button" className={styles.btnGhost} onClick={cancelReview} disabled={reviewSaving}>
                  Cancel
                </button>
                <button type="button" className={styles.btnPrimary} onClick={saveReview} disabled={reviewSaving}>
                  {reviewSaving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </>
        ) : reviewNote ? (
          <p className={styles.reviewBody}>{reviewNote}</p>
        ) : (
          <p className={styles.reviewEmpty}>No notes for this day yet. Tap Edit to add.</p>
        )}
        {reviewError && <p className={styles.reviewErrorMsg}>{reviewError}</p>}
      </section>

      {/* BEST SELLERS */}
      <section className={styles.bestCard}>
        <div className={styles.bestHeader}>
          <p className={styles.sectionLabel}>BEST SELLER TODAY</p>
        </div>
        {bestSellers.length === 0 ? (
          <p className={styles.mutedSmall}>{stats ? "No data yet" : "Loading…"}</p>
        ) : (
          <ul className={styles.bestList}>
            {bestSellers.map((item, i) => (
              <li key={item.name} className={styles.bestItem}>
                <span className={styles.bestRank}>{i + 1}</span>
                <span className={styles.bestName}>{item.name}</span>
                <span className={styles.bestSales}>{fmtCurrency(item.sales)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
