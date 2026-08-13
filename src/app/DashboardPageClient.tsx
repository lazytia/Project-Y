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
  /** Same money as todaySales, cut at 3:00 PM. Null until Square answers. */
  lunchSales: number | null;
  dinnerSales: number | null;
  transactions: number;
  transactionsChange: number;
  avgSpendPerTable: number;
  avgSpendChange: number;
  weeklyProgress: number;
  peakHour: string | null;
  peakHourOrders: number;
  bestSellers: { name: string; sales: number; quantity: number }[];
};

function emptyStats(sales = 0): Stats {
  return {
    todaySales: sales,
    lunchSales: null,
    dinnerSales: null,
    transactions: 0,
    transactionsChange: 0,
    avgSpendPerTable: 0,
    avgSpendChange: 0,
    weeklyProgress: 0,
    peakHour: null,
    peakHourOrders: 0,
    bestSellers: [],
  };
}

/**
 * Cards reveal independently. A single dashboard-wide flag meant the slowest
 * request decided when EVERY number appeared, so a 1s sales figure sat behind
 * "—" until an unrelated 8s request gave up.
 *
 * Each group covers exactly the fetches that feed one card, so a card still
 * never paints a cached number that its own live fetch is about to rewrite.
 */
type MetricGroup = "sales" | "reservations" | "week" | "catering";
type MetricsReady = Record<MetricGroup, boolean>;

const METRICS_PENDING: MetricsReady = {
  sales: false,
  reservations: false,
  week: false,
  catering: false,
};
const METRICS_ALL_READY: MetricsReady = {
  sales: true,
  reservations: true,
  week: true,
  catering: true,
};

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
   * Which cards have their LIVE numbers in — i.e. what is on screen is real,
   * not a cached guess.
   *
   * Every group deliberately starts false even when we have a cache. Showing
   * the cached figure first meant the owner saw one number, then watched it
   * change a second later once the live value landed, which read as a bug.
   * We render "—" until the real number is in.
   */
  const [metricsReady, setMetricsReady] = useState<MetricsReady>(METRICS_PENDING);
  /**
   * Mirror of `metricsReady` readable from inside async callbacks. Used to
   * drop the parts of a server snapshot that arrive after those live numbers
   * are already on screen — applying them then would visibly rewrite them.
   */
  const metricsReadyRef = useRef(METRICS_PENDING);
  metricsReadyRef.current = metricsReady;

  const markMetricReady = useCallback((group: MetricGroup) => {
    setMetricsReady((prev) => (prev[group] ? prev : { ...prev, [group]: true }));
  }, []);

  /** Bumped to force a fresh round of fetches without changing the date. */
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    const key = sydneyTodayKey();
    setTodayKey(key);
    setSelectedDate(key);
  }, []);

  const todayKeyRef = useRef("");
  todayKeyRef.current = todayKey;
  const selectedDateRef = useRef("");
  selectedDateRef.current = selectedDate;

  // Resuming the PWA does NOT remount this component — iOS keeps the page
  // alive in the background, so coming back to the app leaves last session's
  // numbers sitting on screen. Force a fresh round of fetches (and roll the
  // date over if it is a new day) every time we become visible again.
  useEffect(() => {
    const onResume = () => {
      if (document.visibilityState !== "visible") return;
      const key = sydneyTodayKey();
      const wasOnToday = selectedDateRef.current === todayKeyRef.current;
      setTodayKey(key);
      if (wasOnToday) setSelectedDate(key);
      setRefreshTick((n) => n + 1);
    };
    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("pageshow", onResume);
    return () => {
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("pageshow", onResume);
    };
  }, []);

  const isToday = !!selectedDate && selectedDate === todayKey;
  const dailyTarget = selectedDate ? DAILY_TARGETS[dowOfDateKey(selectedDate)] ?? 0 : 0;
  const weekMondayISO = selectedDate ? isoMondayOf(selectedDate) : "";

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
          lunchSales: initialCache?.lunchSales ?? null,
          dinnerSales: initialCache?.dinnerSales ?? null,
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
  const [weekSalesDoc, setWeekSalesDoc] = useState<number | null>(initialCache?.weekSalesDoc ?? null);
  /**
   * Mon–Sun gross sales for the selected week and the one before it, straight
   * from Square. Both halves of the THIS WEEK card are summed from this single
   * source so the "vs last week" delta is always internally consistent.
   */
  const [weekDaily, setWeekDaily] = useState<{ thisWeek: number[]; lastWeek: number[] } | null>(null);
  const [reviewNote, setReviewNote] = useState(initialCache?.reviewNote ?? "");
  const [reviewEditing, setReviewEditing] = useState(false);
  const [reviewDraft, setReviewDraft] = useState(initialCache?.reviewNote ?? "");
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  /** `skip` holds the groups whose live numbers already won the race; writing
   *  cached values over those would swap a correct figure for an older one. */
  const applyOwnerCache = useCallback((
    cache: DashCache | null,
    skip: MetricsReady = METRICS_PENDING,
  ): boolean => {
    if (!cache) return false;
    const hasNumbers =
      typeof cache.todaySales === "number" ||
      typeof cache.savedDaySales === "number" ||
      typeof cache.weeklyProgress === "number" ||
      typeof cache.weekSalesDoc === "number" ||
      typeof cache.lunchPax === "number";
    if (!hasNumbers) return false;

    const sales =
      typeof cache.todaySales === "number"
        ? cache.todaySales
        : typeof cache.savedDaySales === "number"
          ? cache.savedDaySales
          : null;
    if (sales !== null && !skip.sales) {
      setStats((prev) => ({
        ...(prev ?? emptyStats(sales)),
        todaySales: sales,
        lunchSales: cache.lunchSales ?? prev?.lunchSales ?? null,
        dinnerSales: cache.dinnerSales ?? prev?.dinnerSales ?? null,
        weeklyProgress: cache.weeklyProgress ?? prev?.weeklyProgress ?? 0,
        bestSellers: cache.bestSellers ?? prev?.bestSellers ?? [],
      }));
    }
    if (
      !skip.reservations &&
      (typeof cache.lunchPax === "number" || typeof cache.dinnerPax === "number")
    ) {
      setCachedPax({
        lunchPax: cache.lunchPax ?? 0,
        dinnerPax: cache.dinnerPax ?? 0,
      });
    }
    if (!skip.week && typeof cache.weekSalesDoc === "number") setWeekSalesDoc(cache.weekSalesDoc);
    if (typeof cache.reviewNote === "string") {
      setReviewNote(cache.reviewNote);
      setReviewDraft(cache.reviewNote);
    }
    if (
      !skip.catering &&
      (typeof cache.nextCateringISO === "string" ||
        typeof cache.weekCateringCount === "number")
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
        lunchSales: data.lunchSales ?? undefined,
        dinnerSales: data.dinnerSales ?? undefined,
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

  const fetchWeekDaily = useCallback(async (monday: string) => {
    if (!monday) return;
    try {
      const res = await fetch(
        `/api/square/weekly-daily?weekStart=${encodeURIComponent(monday)}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        thisWeek?: { daily?: number[] };
        lastWeek?: { daily?: number[] };
      };
      const thisWeek = data.thisWeek?.daily;
      const lastWeek = data.lastWeek?.daily;
      if (!Array.isArray(thisWeek) || !Array.isArray(lastWeek)) return;
      setWeekDaily({ thisWeek, lastWeek });
    } catch {
      /* the card falls back to the sales_weekly running total */
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
    setMetricsReady(METRICS_PENDING);

    const hadCache =
      applyOwnerCache(readDashCache(selectedDate)) ||
      (!!initialCache && applyOwnerCache(initialCache));
    if (!hadCache) {
      setStats(null);
      setReservations(null);
      setCateringOrders(null);
      setCachedPax(null);
      setCachedCatering(null);
      setWeekSalesDoc(null);
      setWeekDaily(null);
      setReviewNote("");
      setReviewDraft("");
    }
    setStatsError(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  // Each group opens its own card as soon as the fetches behind that card
  // land, so one slow request no longer holds the whole dashboard at "—".
  const runMetricGroup = useCallback(
    (name: MetricGroup, isCancelled: () => boolean, work: Promise<unknown>[]) =>
      Promise.allSettled(work).then(() => {
        if (!isCancelled()) markMetricReady(name);
      }),
    [markMetricReady],
  );

  // Live refresh. Needs the Firebase client SDK, so it waits for `user`.
  useEffect(() => {
    if (!selectedDate || !user) return;
    let cancelled = false;
    const isCancelled = () => cancelled;

    // Close the gates for THIS round of fetches.
    //
    // This is the case the earlier fix missed. metricsReady was only reset by
    // the `selectedDate` effect, so on resume — same date, component never
    // unmounted — it stayed true and last session's numbers rendered with no
    // "—" phase at all, then silently changed once the refetch landed.
    setMetricsReady(METRICS_PENDING);

    // Safety valve: if a fetch hangs we still reveal whatever we have
    // (usually the cache) rather than leaving the owner staring at "—".
    const reveal = setTimeout(() => {
      if (!cancelled) setMetricsReady(METRICS_ALL_READY);
    }, 8_000);

    void Promise.allSettled([
      runMetricGroup("sales", isCancelled, [
        fetchSalesBrief(selectedDate),
        fetchStats(selectedDate),
      ]),
      runMetricGroup("reservations", isCancelled, [fetchReservations(selectedDate)]),
      runMetricGroup("catering", isCancelled, [fetchCatering()]),
      runMetricGroup("week", isCancelled, [
        fetchWeekDaily(weekMondayISO),
        fetchWeekSales(weekMondayISO, selectedDate),
      ]),
      fetchReviewNote(selectedDate),
    ]).then(() => {
      clearTimeout(reveal);
    });

    return () => {
      cancelled = true;
      clearTimeout(reveal);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, weekMondayISO, user?.uid, refreshTick]);

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
        // Skip the cards whose live fetches already won the race — painting
        // the snapshot there would swap a correct number for an older one.
        applyOwnerCache(data.cache, metricsReadyRef.current);
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

  /** 0 = Monday … 6 = Sunday. How far into the week the selected date sits. */
  const weekDayOffset = useMemo(() => {
    if (!selectedDate || !weekMondayISO) return 0;
    const ms = Date.parse(`${selectedDate}T00:00:00Z`) - Date.parse(`${weekMondayISO}T00:00:00Z`);
    return Math.min(6, Math.max(0, Math.round(ms / 86_400_000)));
  }, [selectedDate, weekMondayISO]);

  /** Mon → selected day inclusive. Comparing full weeks against a part-week
   *  is what made the old "vs last week" figure meaningless. */
  const sumToSelectedDay = useCallback(
    (daily: number[] | undefined) =>
      daily ? daily.slice(0, weekDayOffset + 1).reduce((sum, n) => sum + (n || 0), 0) : null,
    [weekDayOffset],
  );

  const weeklySales =
    sumToSelectedDay(weekDaily?.thisWeek) ?? weekSalesDoc ?? stats?.weeklyProgress ?? null;
  const lastWeekToDate = sumToSelectedDay(weekDaily?.lastWeek);

  const lastWeekDelta =
    weeklySales !== null && lastWeekToDate !== null ? weeklySales - lastWeekToDate : null;
  const lastWeekDeltaPct =
    lastWeekDelta !== null && lastWeekToDate ? (lastWeekDelta / lastWeekToDate) * 100 : null;

  // ── display gate ──────────────────────────────────────────────────
  // Everything the cards render goes through here. Until metricsReady we
  // hand back null so each card falls through to its "—" placeholder,
  // rather than briefly showing a cached figure that the live fetch is
  // about to overwrite with a different number.
  const shownTodaySales =
    metricsReady.sales && typeof stats?.todaySales === "number" ? stats.todaySales : null;
  const shownLunchSales =
    metricsReady.sales && typeof stats?.lunchSales === "number" ? stats.lunchSales : null;
  const shownDinnerSales =
    metricsReady.sales && typeof stats?.dinnerSales === "number" ? stats.dinnerSales : null;
  const shownResCounts = metricsReady.reservations ? resCounts : null;
  const shownWeeklySales = metricsReady.week ? weeklySales : null;
  const shownLastWeekToDate = metricsReady.week ? lastWeekToDate : null;
  const shownLastWeekDelta = metricsReady.week ? lastWeekDelta : null;
  const shownLastWeekDeltaPct = metricsReady.week ? lastWeekDeltaPct : null;
  const shownWeekCateringCount = metricsReady.catering ? weekCateringCount : null;
  const shownNextCatering = metricsReady.catering ? nextCatering : null;

  const bestSellers = metricsReady.sales ? (stats?.bestSellers ?? []).slice(0, 3) : [];

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
          <span className={styles.sectionLabel}>
            TODAY {selectedDate && <>&bull; {formatHeaderDate(selectedDate).toUpperCase()}</>}
          </span>
          <Link href="/operations/reservations" className={styles.viewLink}>View</Link>
        </div>
        <div className={styles.todayBody}>
          <div className={styles.todayLeft}>
            <p className={styles.miniLabel}>TOTAL SALES</p>
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
              <span className={styles.mealIcon} aria-hidden="true">☀️</span>
              <div className={styles.mealCol}>
                <p className={styles.mealTitle}>LUNCH SALES</p>
                <p className={styles.mealValue}>
                  {shownLunchSales !== null ? fmtCurrency(shownLunchSales) : "—"}
                </p>
                <p className={styles.mealSub}>
                  <span aria-hidden="true">👤</span> {shownResCounts?.lunchPax ?? "—"} PAX
                </p>
              </div>
            </div>
            <div className={`${styles.mealRow} ${styles.mealRowDivided}`}>
              <span className={styles.mealIcon} aria-hidden="true">🌙</span>
              <div className={styles.mealCol}>
                <p className={styles.mealTitle}>DINNER SALES</p>
                <p className={styles.mealValue}>
                  {shownDinnerSales !== null ? fmtCurrency(shownDinnerSales) : "—"}
                </p>
                <p className={styles.mealSub}>
                  <span aria-hidden="true">👥</span> {shownResCounts?.dinnerPax ?? "—"} PAX
                </p>
              </div>
            </div>
          </div>
        </div>
        {statsError && metricsReady.sales && <p className={styles.errorBadge}>Square 연결 오류</p>}
        {lastUpdated && !statsError && metricsReady.sales && (
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
            <p className={styles.miniLabelOnDark}>WEEK TO DATE SALES</p>
            <p className={styles.weekAmount}>
              {shownWeeklySales !== null ? fmtCurrency(shownWeeklySales) : "—"}
            </p>
            <p className={styles.targetSubOnDark}>Weekly Target {fmtCurrencyWhole(WEEKLY_TARGET)}</p>
            <Progress value={shownWeeklySales ?? 0} max={WEEKLY_TARGET} pctRight tone="onDark" />
          </div>
          <div className={styles.weekDivider} aria-hidden="true" />
          <div className={styles.weekRight}>
            <p className={styles.miniLabelOnDark}>LAST WEEK UP TO TODAY</p>
            <p className={styles.weekAmount}>
              {shownLastWeekToDate !== null ? fmtCurrency(shownLastWeekToDate) : "—"}
            </p>
            {shownLastWeekDelta !== null && shownLastWeekDeltaPct !== null && (
              <p
                className={`${styles.weekDelta} ${shownLastWeekDelta >= 0 ? styles.deltaPos : styles.deltaNeg}`}
              >
                {shownLastWeekDelta >= 0 ? "↑" : "↓"} {fmtCurrency(Math.abs(shownLastWeekDelta))} (
                {Math.abs(shownLastWeekDeltaPct).toFixed(1)}%)
              </p>
            )}
            <p className={styles.targetSubOnDark}>vs last week up to today</p>
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
          <p className={styles.mutedSmall}>{!metricsReady.sales ? "Loading…" : "No data yet"}</p>
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
