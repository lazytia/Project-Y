"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import styles from "./page.module.css";
import DashboardReadyMarker from "@/components/DashboardReadyMarker";
import ManagerDashboard from "@/components/ManagerDashboard";
import { useAuth } from "@/components/AuthProvider";
import { isOwner, isStrictOwner, isChef } from "@/lib/permissions";
import {
  resolveDashboardKind,
} from "@/lib/resolve-dashboard-kind";
import { isManagerDashboardKind } from "@/lib/session-dashboard";
import { hasClientSessionHint, readClientDashboardHint } from "@/lib/client-session-hint";
import {
  readDashCache,
  writeDashCache,
  type DashCache,
} from "@/lib/owner-dash-cache";
import type { ManagerDashCache } from "@/lib/manager-dash-cache";
import type { OwnerDashServerSnapshot } from "@/lib/owner-dash-server";
import type { DashboardKind } from "@/lib/session-dashboard";
import dynamic from "next/dynamic";
import {
  addDaysISO,
  dowOfDateKey,
  isoMondayOf,
  sydneyTodayKey,
} from "@/lib/sydney-date";
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

const CalendarPicker = dynamic(() => import("@/components/CalendarPicker"), {
  ssr: false,
});
const DashboardAttention = dynamic(() => import("@/components/DashboardAttention"), {
  ssr: false,
});

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

export default function DashboardPageClient({
  sessionDashboard = null,
  initialManagerCache = null,
  initialOwnerCache = null,
}: {
  sessionDashboard?: DashboardKind | null;
  initialManagerCache?: ManagerDashCache | null;
  initialOwnerCache?: DashCache | null;
}) {
  const { user, loading } = useAuth();
  const effectiveDashboard = resolveDashboardKind(sessionDashboard, user);
  const dashHint = readClientDashboardHint();
  const hintedDash =
    dashHint === "owner" ||
    dashHint === "manager" ||
    dashHint === "chef" ||
    dashHint === "staff"
      ? dashHint
      : null;
  const dashKind = effectiveDashboard ?? hintedDash;

  const managerProps = {
    hideAttention: false,
    roleLabel: dashKind === "chef" ? "Head Chef" : "Store Manager",
    displayName: dashKind === "chef" ? "Chuck" : undefined,
    sessionDashboard: isManagerDashboardKind(dashKind) ? dashKind : effectiveDashboard,
    initialCache: initialManagerCache,
  };

  const showOwnerDash = dashKind === "owner";
  const showManagerDash = isManagerDashboardKind(dashKind);

  if (loading || !user) {
    if (showOwnerDash) {
      return <OwnerDashboard sessionDashboard={dashKind} initialCache={initialOwnerCache} />;
    }
    if (showManagerDash || hasClientSessionHint()) {
      return (
        <ManagerDashboard
          {...managerProps}
          sessionDashboard={
            isManagerDashboardKind(dashKind)
              ? dashKind
              : hintedDash === "chef"
                ? "chef"
                : "manager"
          }
        />
      );
    }
    return <ManagerDashboard sessionDashboard="manager" initialCache={initialManagerCache} />;
  }

  const userIsChef = isChef(user);
  const userIsManager = (isOwner(user) && !isStrictOwner(user)) || userIsChef;

  if (userIsManager) {
    return (
      <ManagerDashboard
        hideAttention={false}
        roleLabel={userIsChef ? "Head Chef" : "Store Manager"}
        displayName={userIsChef ? "Chuck" : undefined}
        sessionDashboard={userIsChef ? "chef" : "manager"}
        initialCache={initialManagerCache}
      />
    );
  }

  return <OwnerDashboard sessionDashboard="owner" initialCache={initialOwnerCache} />;
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

function emptyStats(sales = 0): Stats {
  return {
    todaySales: sales,
    transactions: 0,
    transactionsChange: 0,
    avgSpendPerTable: 0,
    avgSpendChange: 0,
    restaurantSales: 0,
    platterSales: 0,
    weeklyProgress: 0,
    peakHour: null,
    peakHourOrders: 0,
    bestSellers: [],
  };
}

function OwnerDashboard({
  sessionDashboard = null,
  initialCache = null,
}: {
  sessionDashboard?: DashboardKind | null;
  initialCache?: DashCache | null;
}) {
  const { user, loading: authLoading } = useAuth();
  const [todayKey, setTodayKey] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  /**
   * True once the LIVE fetches have settled — i.e. the numbers on screen
   * are the real ones, not a cached guess.
   *
   * This deliberately starts false even when we have a cache. Showing the
   * cached figure first meant the owner saw one number, then watched it
   * change a second later once the live value landed, which read as a
   * bug. We now render "—" until the real number is in.
   */
  const [metricsReady, setMetricsReady] = useState(false);
  /**
   * Mirror of `metricsReady` readable from inside async callbacks. Used to
   * drop a server snapshot that arrives after the live numbers are already
   * on screen — applying it then would visibly rewrite them.
   */
  const metricsReadyRef = useRef(false);
  metricsReadyRef.current = metricsReady;

  useEffect(() => {
    const key = sydneyTodayKey();
    setTodayKey(key);
    setSelectedDate(key);
  }, []);

  const isToday = !!selectedDate && selectedDate === todayKey;
  const dailyTarget = selectedDate ? DAILY_TARGETS[dowOfDateKey(selectedDate)] ?? 0 : 0;
  const weekMondayISO = selectedDate ? isoMondayOf(selectedDate) : "";
  const prevMondayISO = weekMondayISO ? addDaysISO(weekMondayISO, -7) : "";

  const seedSales =
    typeof initialCache?.todaySales === "number"
      ? initialCache.todaySales
      : typeof initialCache?.savedDaySales === "number"
        ? initialCache.savedDaySales
        : null;

  const [stats, setStats] = useState<Stats | null>(() =>
    seedSales !== null
      ? {
          ...emptyStats(seedSales),
          restaurantSales: initialCache?.restaurantSales ?? 0,
          platterSales: initialCache?.platterSales ?? 0,
          weeklyProgress: initialCache?.weeklyProgress ?? 0,
          bestSellers: initialCache?.bestSellers ?? [],
        }
      : null,
  );
  const [statsError, setStatsError] = useState(false);
  const [reservations, setReservations] = useState<Reservation[] | null>(null);
  const [cateringOrders, setCateringOrders] = useState<CateringOrder[] | null>(null);
  const [cachedPax, setCachedPax] = useState<{ lunchPax: number; dinnerPax: number } | null>(() =>
    typeof initialCache?.lunchPax === "number" || typeof initialCache?.dinnerPax === "number"
      ? { lunchPax: initialCache?.lunchPax ?? 0, dinnerPax: initialCache?.dinnerPax ?? 0 }
      : null,
  );
  const [cachedCatering, setCachedCatering] = useState<{
    nextCateringISO?: string;
    weekCateringCount?: number;
  } | null>(() =>
    typeof initialCache?.nextCateringISO === "string" ||
    typeof initialCache?.weekCateringCount === "number"
      ? {
          nextCateringISO: initialCache?.nextCateringISO,
          weekCateringCount: initialCache?.weekCateringCount,
        }
      : null,
  );
  const [lunchStaff, setLunchStaff] = useState<number | null>(initialCache?.lunchStaff ?? null);
  const [dinnerStaff, setDinnerStaff] = useState<number | null>(initialCache?.dinnerStaff ?? null);
  const [prevWeekSales, setPrevWeekSales] = useState<number | null>(initialCache?.prevWeekSales ?? null);
  const [weekSalesDoc, setWeekSalesDoc] = useState<number | null>(initialCache?.weekSalesDoc ?? null);
  const [weeklyPayroll, setWeeklyPayroll] = useState<number | null>(initialCache?.weeklyPayroll ?? null);
  const [reviewNote, setReviewNote] = useState(initialCache?.reviewNote ?? "");
  const [reviewEditing, setReviewEditing] = useState(false);
  const [reviewDraft, setReviewDraft] = useState(initialCache?.reviewNote ?? "");
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const applyOwnerCache = useCallback((cache: DashCache | null): boolean => {
    if (!cache) return false;
    const hasNumbers =
      typeof cache.todaySales === "number" ||
      typeof cache.savedDaySales === "number" ||
      typeof cache.weeklyProgress === "number" ||
      typeof cache.weekSalesDoc === "number" ||
      typeof cache.lunchPax === "number" ||
      typeof cache.lunchStaff === "number";
    if (!hasNumbers) return false;

    const sales =
      typeof cache.todaySales === "number"
        ? cache.todaySales
        : typeof cache.savedDaySales === "number"
          ? cache.savedDaySales
          : null;
    if (sales !== null) {
      setStats((prev) => ({
        ...(prev ?? emptyStats(sales)),
        todaySales: sales,
        restaurantSales: cache.restaurantSales ?? prev?.restaurantSales ?? 0,
        platterSales: cache.platterSales ?? prev?.platterSales ?? 0,
        weeklyProgress: cache.weeklyProgress ?? prev?.weeklyProgress ?? 0,
        bestSellers: cache.bestSellers ?? prev?.bestSellers ?? [],
      }));
    }
    if (typeof cache.lunchPax === "number" || typeof cache.dinnerPax === "number") {
      setCachedPax({
        lunchPax: cache.lunchPax ?? 0,
        dinnerPax: cache.dinnerPax ?? 0,
      });
    }
    if (typeof cache.lunchStaff === "number") setLunchStaff(cache.lunchStaff);
    if (typeof cache.dinnerStaff === "number") setDinnerStaff(cache.dinnerStaff);
    if (typeof cache.prevWeekSales === "number") setPrevWeekSales(cache.prevWeekSales);
    if (typeof cache.weekSalesDoc === "number") setWeekSalesDoc(cache.weekSalesDoc);
    if (typeof cache.weeklyPayroll === "number") setWeeklyPayroll(cache.weeklyPayroll);
    if (typeof cache.reviewNote === "string") {
      setReviewNote(cache.reviewNote);
      setReviewDraft(cache.reviewNote);
    }
    if (
      typeof cache.nextCateringISO === "string" ||
      typeof cache.weekCateringCount === "number"
    ) {
      setCachedCatering({
        nextCateringISO: cache.nextCateringISO,
        weekCateringCount: cache.weekCateringCount,
      });
    }
    // NOTE: deliberately does NOT flip metricsReady. Cached numbers are
    // loaded into state so the live fetch has something to merge onto, but
    // they stay hidden behind "—" until the live fetches settle.
    return true;
  }, []);

  const fetchSalesBrief = useCallback(async (dateKey: string) => {
    try {
      const res = await fetch(
        `/api/square/today-sales-brief?date=${encodeURIComponent(dateKey)}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as { todaySales?: number };
      if (typeof data.todaySales !== "number") return;
      setStats((prev) => ({
        ...(prev ?? emptyStats(data.todaySales!)),
        todaySales: data.todaySales!,
      }));
      setStatsError(false);
      setLastUpdated(new Date());
      writeDashCache(dateKey, {
        todaySales: data.todaySales,
        savedDaySales: data.todaySales,
      });
    } catch {
      /* full today-stats still runs */
    }
  }, []);

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
        writeDashCache(dateKey, { savedDaySales: data.todaySales });
      }
    } catch (err) {
      console.error("[Square] fetch error:", err);
      setStatsError(true);
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
      if (weekMondayISO && todayKey) {
        const end = addDaysISO(weekMondayISO, 6);
        const weekCount = orders.filter(
          (o) => o.deliveryDateISO >= weekMondayISO && o.deliveryDateISO <= end && o.status !== "CANCELLED",
        ).length;
        const upcoming = orders
          .filter((o) => (o.status === "CONFIRMED" || o.status === "PENDING") && o.deliveryDateISO >= todayKey)
          .sort((a, b) => a.deliveryDateISO.localeCompare(b.deliveryDateISO));
        writeDashCache(selectedDate, {
          weekCateringCount: weekCount,
          nextCateringISO: upcoming[0]?.deliveryDateISO,
        });
      }
    } catch (err) {
      console.error("[catering] fetch error:", err);
    }
  }, [user, weekMondayISO, todayKey, selectedDate]);

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

  // Paint whatever we already have for this date, and clear stale numbers
  // from the previously selected date. Keyed on `selectedDate` alone —
  // this must NOT re-run when Firebase Auth settles, or it would wipe the
  // metrics the server snapshot just painted.
  useEffect(() => {
    if (!selectedDate) return;

    // Always drop back to the "—" placeholder state for a new date; only
    // the live fetch below is allowed to flip metricsReady back on.
    setMetricsReady(false);

    const hadCache =
      applyOwnerCache(readDashCache(selectedDate)) ||
      (!!initialCache && applyOwnerCache(initialCache));
    if (!hadCache) {
      setStats(null);
      setReservations(null);
      setCateringOrders(null);
      setCachedPax(null);
      setCachedCatering(null);
      setLunchStaff(null);
      setDinnerStaff(null);
      setPrevWeekSales(null);
      setWeekSalesDoc(null);
      setWeeklyPayroll(null);
      setReviewNote("");
      setReviewDraft("");
    }
    setStatsError(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  // Live refresh. Needs the Firebase client SDK, so it waits for `user`.
  useEffect(() => {
    if (!selectedDate || !user) return;
    let cancelled = false;

    // Safety valve: if a fetch hangs we still reveal whatever we have
    // (usually the cache) rather than leaving the owner staring at "—".
    const reveal = setTimeout(() => {
      if (!cancelled) setMetricsReady(true);
    }, 8_000);

    void Promise.allSettled([
      fetchSalesBrief(selectedDate),
      fetchStats(selectedDate),
      fetchReservations(selectedDate),
      fetchCatering(),
      fetchRosterStaff(selectedDate),
      fetchPrevWeekSales(prevMondayISO, selectedDate),
      fetchWeekSales(weekMondayISO, selectedDate),
      fetchWeeklyPayroll(weekMondayISO, selectedDate),
      fetchReviewNote(selectedDate),
    ]).then(() => {
      clearTimeout(reveal);
      if (!cancelled) setMetricsReady(true);
    });

    return () => {
      cancelled = true;
      clearTimeout(reveal);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, prevMondayISO, weekMondayISO, user?.uid]);

  // Server-session snapshot lives in its own effect on purpose. It is
  // authenticated by the uid cookie, not by the Firebase client SDK, so
  // it can (and should) fire before onAuthStateChanged settles. While it
  // sat inside the effect above it ran TWICE on every dashboard open:
  // once when selectedDate landed with user still null, then again when
  // `user?.uid` flipped from undefined to the real uid and re-triggered
  // that effect — repainting every metric with an identical response.
  useEffect(() => {
    if (!selectedDate || sessionDashboard !== "owner") return;
    let cancelled = false;

    void fetch(`/api/dashboard/owner-snapshot?date=${encodeURIComponent(selectedDate)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: OwnerDashServerSnapshot | null) => {
        if (cancelled || !data?.cache) return;
        writeDashCache(data.dateKey, data.cache);
        // The live fetches already won the race — painting the snapshot now
        // would swap a correct number for a slightly older one on screen.
        if (metricsReadyRef.current) return;
        applyOwnerCache(data.cache);
      })
      .catch(() => {
        /* the live fetches still run */
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, sessionDashboard]);

  useEffect(() => {
    if (!selectedDate || !isToday) return;
    const id1 = setInterval(() => fetchStats(selectedDate), POLL_INTERVAL_MS);
    const id2 = setInterval(() => fetchReservations(selectedDate), POLL_INTERVAL_MS);
    return () => { clearInterval(id1); clearInterval(id2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, isToday]);

  const resCounts = useMemo(() => {
    if (reservations) {
      const active = reservations.filter((r) => r.status !== "cancelled" && r.status !== "no-show");
      const lunch = active.filter((r) => serviceFor(r.time) === "LUNCH");
      const dinner = active.filter((r) => serviceFor(r.time) === "DINNER");
      return {
        lunchPax: lunch.reduce((s, r) => s + r.count, 0),
        dinnerPax: dinner.reduce((s, r) => s + r.count, 0),
      };
    }
    return cachedPax;
  }, [reservations, cachedPax]);

  const nextCatering = useMemo((): { deliveryDateISO: string } | null => {
    if (cateringOrders && todayKey) {
      const upcoming = cateringOrders
        .filter((o) => (o.status === "CONFIRMED" || o.status === "PENDING") && o.deliveryDateISO >= todayKey)
        .sort((a, b) => a.deliveryDateISO.localeCompare(b.deliveryDateISO));
      return upcoming[0] ? { deliveryDateISO: upcoming[0].deliveryDateISO } : null;
    }
    if (cachedCatering?.nextCateringISO) {
      return { deliveryDateISO: cachedCatering.nextCateringISO };
    }
    return null;
  }, [cateringOrders, todayKey, cachedCatering]);

  const weekCateringCount = useMemo(() => {
    if (cateringOrders && weekMondayISO) {
      const end = addDaysISO(weekMondayISO, 6);
      return cateringOrders.filter(
        (o) => o.deliveryDateISO >= weekMondayISO && o.deliveryDateISO <= end && o.status !== "CANCELLED",
      ).length;
    }
    return typeof cachedCatering?.weekCateringCount === "number"
      ? cachedCatering.weekCateringCount
      : null;
  }, [cateringOrders, weekMondayISO, cachedCatering]);

  const weeklySales = weekSalesDoc ?? stats?.weeklyProgress ?? null;
  const vsLastWeekPct = useMemo(() => {
    if (weeklySales === null || prevWeekSales === null || !prevWeekSales) return null;
    return ((weeklySales - prevWeekSales) / prevWeekSales) * 100;
  }, [weeklySales, prevWeekSales]);

  const payrollPct = useMemo(() => {
    if (weeklyPayroll === null || weeklySales === null || !weeklySales) return null;
    return (weeklyPayroll / weeklySales) * 100;
  }, [weeklyPayroll, weeklySales]);

  // ── display gate ──────────────────────────────────────────────────
  // Everything the cards render goes through here. Until metricsReady we
  // hand back null so each card falls through to its "—" placeholder,
  // rather than briefly showing a cached figure that the live fetch is
  // about to overwrite with a different number.
  const shownTodaySales =
    metricsReady && typeof stats?.todaySales === "number" ? stats.todaySales : null;
  const shownResCounts = metricsReady ? resCounts : null;
  const shownLunchStaff = metricsReady ? lunchStaff : null;
  const shownDinnerStaff = metricsReady ? dinnerStaff : null;
  const shownWeeklySales = metricsReady ? weeklySales : null;
  const shownVsLastWeekPct = metricsReady ? vsLastWeekPct : null;
  const shownPayrollPct = metricsReady ? payrollPct : null;
  const shownWeekCateringCount = metricsReady ? weekCateringCount : null;
  const shownNextCatering = metricsReady ? nextCatering : null;

  const payrollOnTarget = shownPayrollPct !== null && shownPayrollPct <= PAYROLL_TARGET_PCT;

  const bestSellers = metricsReady ? (stats?.bestSellers ?? []).slice(0, 3) : [];

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

  return (
    <>
      <DashboardReadyMarker when={!authLoading && !!selectedDate} />
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
              const shown = shownTodaySales;
              return (
                <>
                  <p className={`${styles.salesAmount} ${shown === null ? styles.loading : ""}`}>
                    {shown !== null ? fmtCurrency(shown) : "—"}
                  </p>
                  <p className={styles.targetSub}>
                    Target <span className={styles.strong}>{fmtCurrencyWhole(dailyTarget)}</span>
                  </p>
                  <Progress value={shown ?? 0} max={dailyTarget} pctRight />
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
                  {shownResCounts?.lunchPax ?? "—"} <span className={styles.mealUnit}>PAX</span>
                </p>
                <p className={styles.mealSub}>
                  <span aria-hidden="true">👥</span> {shownLunchStaff !== null ? shownLunchStaff : "—"} STAFF
                </p>
              </div>
            </div>
            <div className={styles.mealRow}>
              <span className={styles.mealIcon}>🌙</span>
              <div className={styles.mealCol}>
                <p className={styles.mealTitle}>DINNER</p>
                <p className={styles.mealValue}>
                  {shownResCounts?.dinnerPax ?? "—"} <span className={styles.mealUnit}>PAX</span>
                </p>
                <p className={styles.mealSub}>
                  <span aria-hidden="true">👥</span> {shownDinnerStaff !== null ? shownDinnerStaff : "—"} STAFF
                </p>
              </div>
            </div>
          </div>
        </div>
        {statsError && metricsReady && <p className={styles.errorBadge}>Square 연결 오류</p>}
        {lastUpdated && !statsError && metricsReady && (
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
              {shownWeeklySales !== null ? fmtCurrency(shownWeeklySales) : "—"}
            </p>
            <p className={styles.targetSubOnDark}>Target {fmtCurrencyWhole(WEEKLY_TARGET)}</p>
            <Progress value={shownWeeklySales ?? 0} max={WEEKLY_TARGET} tone="onDark" />
            <p className={styles.weekVs}>
              vs last week{" "}
              {shownVsLastWeekPct !== null ? (
                <span className={shownVsLastWeekPct >= 0 ? styles.deltaPos : styles.deltaNeg}>
                  {shownVsLastWeekPct >= 0 ? "+" : ""}{shownVsLastWeekPct.toFixed(0)}% {shownVsLastWeekPct >= 0 ? "↑" : "↓"}
                </span>
              ) : "—"}
            </p>
          </div>
          <div className={styles.weekDivider} aria-hidden="true" />
          <div className={styles.weekRight}>
            <p className={styles.miniLabelOnDark}>PAYROLL %</p>
            <p className={styles.payrollPct}>
              {shownPayrollPct !== null ? `${shownPayrollPct.toFixed(1)}%` : "—"}
            </p>
            <p className={styles.targetSubOnDark}>Target {PAYROLL_TARGET_PCT}%</p>
            {shownPayrollPct !== null && (
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
              {shownWeekCateringCount ?? "—"} <span className={styles.cateringUnit}>Orders</span>
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
          {shownNextCatering ? (
            <>
              <p className={styles.cateringCountdown}>{dCountdownLabel(shownNextCatering.deliveryDateISO)}</p>
              <p className={styles.cateringDate}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                {new Date(shownNextCatering.deliveryDateISO + "T00:00:00").toLocaleDateString("en-AU", {
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
          <p className={styles.mutedSmall}>{!metricsReady ? "Loading…" : stats ? "No data yet" : "No data yet"}</p>
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
    </>
  );
}
