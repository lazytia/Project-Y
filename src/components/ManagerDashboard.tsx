"use client";

import Link from "next/link";
import { useEffect, useState, useCallback, useMemo } from "react";
import type { User } from "firebase/auth";
import { collection, doc, getDocs, getDoc, type Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { emailToUsername } from "@/lib/username";
import { dCountdownLabel } from "@/lib/catering-orders";
import { fetchReservationsForDate, type Reservation } from "@/lib/reservations";
import {
  hasManagerDashCache,
  readManagerDashCache,
  writeManagerDashCache,
  type ManagerDashCache,
} from "@/lib/manager-dash-cache";
import type { ManagerDashServerSnapshot } from "@/lib/manager-dash-server";
import type { DashboardKind } from "@/lib/session-dashboard";
import { isManagerDashboardKind } from "@/lib/session-dashboard";
import { sydneyTodayKey } from "@/lib/sydney-date";
import DashboardReadyMarker from "@/components/DashboardReadyMarker";
import styles from "./ManagerDashboard.module.css";

type AttentionCounts = {
  holidayRequests: number;
  availabilityChanges: number;
  newOnboarding: number;
  visaExpiring: number;
};

type StoredRequest = { status?: string };

type StaffDoc = {
  role?: string;
  status?: string;
  completedStep?: number;
  documents?: { visaExpiry?: Timestamp };
  holidayRequests?: StoredRequest[];
  availabilityRequests?: StoredRequest[];
};

const VISA_EXPIRING_WINDOW_DAYS = 60;

/** day-of-week daily sales targets (0=Sun … 6=Sat) */
const DAILY_TARGETS: Record<number, number> = {
  0: 0, 1: 3_800, 2: 5_200, 3: 5_500, 4: 6_500, 5: 6_000, 6: 3_000,
};

function isoDateToMonday(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - dow);
  return dt.toISOString().slice(0, 10);
}

function tsDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object" && v !== null && "toDate" in (v as object)) {
    try { return (v as Timestamp).toDate(); } catch { return null; }
  }
  return null;
}

function isVisaExpiringSoon(exp: Date | null): boolean {
  if (!exp) return false;
  const diff = (exp.getTime() - Date.now()) / 86400000;
  return diff <= VISA_EXPIRING_WINDOW_DAYS && diff >= -3;
}

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(n);
}

function greetingForNow(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 18) return "Good Afternoon";
  return "Good Evening";
}

function firstNameFromUsername(username: string): string {
  if (!username) return "there";
  return username.charAt(0).toUpperCase() + username.slice(1);
}

function applyManagerCache(cache: ManagerDashCache) {
  return {
    todaySales: cache.todaySales,
    cachedResCounts:
      cache.totalPax !== null && cache.totalBookings !== null
        ? { totalPax: cache.totalPax, totalBookings: cache.totalBookings }
        : null,
    nextCatering: cache.nextCatering,
    weekCateringCount: cache.weekCateringCount,
    kitchenStaff: cache.kitchenStaff,
    hallStaff: cache.hallStaff,
  };
}

async function authHeader(user: User | null | undefined): Promise<HeadersInit> {
  if (!user) return {};
  const idToken = await user.getIdToken();
  return { Authorization: `Bearer ${idToken}` };
}

async function fetchRolesForUids(uids: string[]): Promise<Map<string, string>> {
  const roleMap = new Map<string, string>();
  if (uids.length === 0) return roleMap;
  await Promise.all(
    uids.map(async (uid) => {
      try {
        const snap = await getDoc(doc(getDb(), "staff_onboarding", uid));
        roleMap.set(uid, snap.exists() ? (snap.data().role as string) ?? "staff" : "staff");
      } catch {
        roleMap.set(uid, "staff");
      }
    }),
  );
  return roleMap;
}

async function fetchCateringSummary(
  user: User | null | undefined,
  dateKey: string,
): Promise<{ nextOrder: { deliveryDateISO: string } | null; weekCount: number }> {
  const res = await fetch(`/api/catering-orders/summary?date=${encodeURIComponent(dateKey)}`, {
    cache: "no-store",
    headers: await authHeader(user),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { nextOrder: null, weekCount: 0 };
  return {
    nextOrder: data.nextOrder?.deliveryDateISO
      ? { deliveryDateISO: data.nextOrder.deliveryDateISO as string }
      : null,
    weekCount: typeof data.weekCount === "number" ? data.weekCount : 0,
  };
}

async function fetchTeamCounts(dateKey: string): Promise<{ kitchen: number; hall: number }> {
  const weekKey = isoDateToMonday(dateKey);
  const rSnap = await getDoc(doc(getDb(), "rosters_published", weekKey));
  if (!rSnap.exists()) return { kitchen: 0, hall: 0 };

  const rData = rSnap.data() as {
    assignments?: Record<string, Record<string, Record<string, string>>>;
  };
  const dayAssign = rData.assignments?.[dateKey] ?? {};
  const allUids = new Set<string>();
  for (const meal of Object.values(dayAssign)) {
    for (const uid of Object.keys(meal)) allUids.add(uid);
  }

  const roleMap = await fetchRolesForUids([...allUids]);
  let kitchen = 0;
  let hall = 0;
  for (const uid of allUids) {
    const role = roleMap.get(uid) ?? "staff";
    if (role === "chef" || role === "kitchen") kitchen++;
    else hall++;
  }
  return { kitchen, hall };
}

type DashboardProps = {
  roleLabel?: string;
  displayName?: string;
  hideAttention?: boolean;
  sessionDashboard?: DashboardKind | null;
};

export default function ManagerDashboard({
  roleLabel = "Store Manager",
  displayName,
  hideAttention = false,
  sessionDashboard = null,
}: DashboardProps = {}) {
  const { user, loading: authLoading } = useAuth();
  const [firstName, setFirstName] = useState<string>("");
  const [attention, setAttention] = useState<AttentionCounts>({
    holidayRequests: 0, availabilityChanges: 0, newOnboarding: 0, visaExpiring: 0,
  });

  // Both start empty so SSR and hydration match. Filled in a client-only
  // effect below — greetingForNow() reads local hours (UTC on the server,
  // Sydney on the client) and would otherwise trigger React #418.
  const [todayKey, setTodayKey] = useState("");
  const [greeting, setGreeting] = useState("");
  useEffect(() => {
    setTodayKey(sydneyTodayKey());
    setGreeting(greetingForNow());
  }, []);

  // All dashboard metrics start null so SSR and hydration produce the same
  // "—" placeholders. The sessionStorage cache is applied in the effect
  // below, after hydration finishes — otherwise a cache hit would render
  // real numbers on the client while the server rendered dashes and React
  // would throw hydration error #418.
  const [todaySales, setTodaySales] = useState<number | null>(null);
  const [reservations, setReservations] = useState<Reservation[] | null>(null);
  const [cachedResCounts, setCachedResCounts] = useState<{ totalPax: number; totalBookings: number } | null>(null);
  const [nextCatering, setNextCatering] = useState<{ deliveryDateISO: string } | null>(null);
  const [weekCateringCount, setWeekCateringCount] = useState<number | null>(null);
  const [kitchenStaff, setKitchenStaff] = useState<number | null>(null);
  const [hallStaff, setHallStaff] = useState<number | null>(null);

  useEffect(() => {
    const date = sydneyTodayKey();
    const cached = readManagerDashCache(date);
    if (!cached) return;
    const applied = applyManagerCache(cached);
    setTodaySales(applied.todaySales);
    if (applied.cachedResCounts) setCachedResCounts(applied.cachedResCounts);
    setNextCatering(applied.nextCatering);
    setWeekCateringCount(applied.weekCateringCount);
    setKitchenStaff(applied.kitchenStaff);
    setHallStaff(applied.hallStaff);
  }, []);

  useEffect(() => {
    if (!isManagerDashboardKind(sessionDashboard)) return;
    const date = todayKey || sydneyTodayKey();
    if (hasManagerDashCache(date)) return;
    let cancelled = false;
    void fetch(
      `/api/dashboard/manager-snapshot?date=${encodeURIComponent(date)}`,
      { cache: "no-store" },
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ManagerDashServerSnapshot | null) => {
        if (cancelled || !data?.cache) return;
        writeManagerDashCache(data.cache);
        const applied = applyManagerCache(data.cache);
        setTodaySales(applied.todaySales);
        if (applied.cachedResCounts) setCachedResCounts(applied.cachedResCounts);
        setNextCatering(applied.nextCatering);
        setWeekCateringCount(applied.weekCateringCount);
        setKitchenStaff(applied.kitchenStaff);
        setHallStaff(applied.hallStaff);
      })
      .catch(() => {
        /* live fetch below still runs */
      });
    return () => {
      cancelled = true;
    };
  }, [sessionDashboard, todayKey]);

  const todayDow = (() => {
    const [y, m, d] = todayKey.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  })();
  const dailyTarget = DAILY_TARGETS[todayDow] ?? 0;

  useEffect(() => {
    setFirstName(displayName ?? firstNameFromUsername(emailToUsername(user?.email)));
  }, [user, displayName]);

  useEffect(() => {
    if (hideAttention) return;
    (async () => {
      try {
        const snap = await getDocs(collection(getDb(), "staff_onboarding"));
        let holidayRequests = 0;
        let availabilityChanges = 0;
        let newOnboarding = 0;
        let visaExpiring = 0;
        for (const d of snap.docs) {
          const data = d.data() as StaffDoc;
          if (data.role === "owner") continue;
          for (const r of data.holidayRequests ?? []) if (r.status === "pending") holidayRequests++;
          for (const r of data.availabilityRequests ?? []) if (r.status === "pending") availabilityChanges++;
          const completed = typeof data.completedStep === "number" ? data.completedStep : 0;
          if (completed >= 7 && data.status === "complete") newOnboarding++;
          if (isVisaExpiringSoon(tsDate(data.documents?.visaExpiry))) visaExpiring++;
        }
        setAttention({ holidayRequests, availabilityChanges, newOnboarding, visaExpiring });
      } catch { /* keep zeros */ }
    })();
  }, [hideAttention]);

  const fetchLiveData = useCallback(async () => {
    const [salesResult, reservationsResult, cateringResult, teamResult] = await Promise.allSettled([
      fetch(`/api/square/today-sales-brief?date=${encodeURIComponent(todayKey)}`).then(async (res) => {
        if (!res.ok) return null;
        const d = await res.json();
        return typeof d.todaySales === "number" ? d.todaySales : null;
      }),
      fetchReservationsForDate(user, todayKey, "northsydney"),
      fetchCateringSummary(user, todayKey),
      fetchTeamCounts(todayKey),
    ]);

    let sales: number | null = null;
    if (salesResult.status === "fulfilled") {
      sales = salesResult.value;
      setTodaySales(sales);
    }

    let totalPax: number | null = null;
    let totalBookings: number | null = null;
    if (reservationsResult.status === "fulfilled") {
      const resList = reservationsResult.value;
      setReservations(resList);
      const active = resList.filter((r) => r.status !== "cancelled" && r.status !== "no-show");
      totalPax = active.reduce((s, r) => s + r.count, 0);
      totalBookings = active.length;
      setCachedResCounts({ totalPax, totalBookings });
    }

    let nextOrder: { deliveryDateISO: string } | null = null;
    let weekCount: number | null = null;
    if (cateringResult.status === "fulfilled") {
      nextOrder = cateringResult.value.nextOrder;
      weekCount = cateringResult.value.weekCount;
      setNextCatering(nextOrder);
      setWeekCateringCount(weekCount);
    }

    let kitchen: number | null = null;
    let hall: number | null = null;
    if (teamResult.status === "fulfilled") {
      kitchen = teamResult.value.kitchen;
      hall = teamResult.value.hall;
      setKitchenStaff(kitchen);
      setHallStaff(hall);
    }

    writeManagerDashCache({
      date: todayKey,
      todaySales: sales,
      totalPax,
      totalBookings,
      nextCatering: nextOrder,
      weekCateringCount: weekCount,
      kitchenStaff: kitchen,
      hallStaff: hall,
    });
  }, [todayKey, user]);

  useEffect(() => {
    if (!todayKey) return;
    fetchLiveData();
    const id = setInterval(fetchLiveData, 60_000);
    return () => clearInterval(id);
  }, [fetchLiveData, todayKey]);

  const resCounts = useMemo(() => {
    if (reservations) {
      const active = reservations.filter(
        (r) => r.status !== "cancelled" && r.status !== "no-show",
      );
      return {
        totalPax: active.reduce((s, r) => s + r.count, 0),
        totalBookings: active.length,
      };
    }
    return cachedResCounts;
  }, [reservations, cachedResCounts]);

  const attentionTotal =
    attention.holidayRequests + attention.availabilityChanges +
    attention.visaExpiring;

  const team = (kitchenStaff ?? 0) + (hallStaff ?? 0);

  const salesPct = useMemo(() => {
    if (todaySales === null || dailyTarget <= 0) return null;
    return Math.min(100, Math.round((todaySales / dailyTarget) * 100));
  }, [todaySales, dailyTarget]);

  return (
    <>
      <DashboardReadyMarker when={!authLoading} />
    <div className={styles.page}>
      <header className={styles.greeting}>
        <h1 className={styles.greetingTitle}>
          {greeting || "Hello"}, {firstName || "there"}
        </h1>
        <p className={styles.greetingRole}>{roleLabel}</p>
      </header>

      {!hideAttention && (
        <section>
          <div className={styles.sectionHead}>
            <p className={styles.sectionLabel}>ATTENTION REQUIRED FOR SCHEDULING</p>
            <span className={styles.attentionBadge}>{attentionTotal}</span>
            <Link href="/attention-required" className={styles.sectionChev} aria-label="View all">›</Link>
          </div>
          <div className={styles.attentionCard}>
            <Link href="/attention-required?filter=holiday" className={styles.attentionCell}>
              <svg className={styles.attentionIcon} width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <p className={styles.attentionValue}>{attention.holidayRequests}</p>
              <p className={styles.attentionLabel}>Holiday<br />Requests</p>
            </Link>

            <Link href="/attention-required?filter=availability" className={styles.attentionCell}>
              <svg className={styles.attentionIcon} width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <circle cx="19" cy="8" r="3" />
              </svg>
              <p className={styles.attentionValue}>{attention.availabilityChanges}</p>
              <p className={styles.attentionLabel}>Availability<br />Change</p>
            </Link>

            <Link href="/attention-required?filter=compliance" className={styles.attentionCell}>
              <svg className={styles.attentionIcon} width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <circle cx="9" cy="11" r="2.2" />
                <path d="M5.5 17c0-1.6 1.6-2.7 3.5-2.7s3.5 1.1 3.5 2.7" />
                <line x1="14" y1="9" x2="18" y2="9" />
                <line x1="14" y1="13" x2="18" y2="13" />
              </svg>
              <p className={styles.attentionValue}>{attention.visaExpiring}</p>
              <p className={styles.attentionLabel}>Visa Expiring<br />Soon</p>
            </Link>
          </div>
        </section>
      )}

      <section>
        <p className={styles.sectionLabel}>TODAY&rsquo;S OPERATIONS</p>
        <div className={styles.opsRow}>
          <div className={styles.opsCard}>
            <div className={styles.opsCardHead}>
              <svg className={styles.opsIcon} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <span className={styles.opsHeadLabel}>Today&rsquo;s Guests</span>
            </div>
            <p className={styles.opsValue}>
              {resCounts ? resCounts.totalPax : "—"}
              {resCounts !== null && <span className={styles.opsUnit}> Pax</span>}
            </p>
            <p className={styles.opsLabel}>{resCounts ? `${resCounts.totalBookings} Reservations` : "Reservations"}</p>
            <Link href="/operations/reservations" className={styles.opsViewLink}>
              View <span aria-hidden="true">→</span>
            </Link>
          </div>

          <div className={styles.opsCard}>
            <div className={styles.opsCardHead}>
              <svg className={styles.opsIcon} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 18h18" />
                <path d="M5 18a7 7 0 0 1 14 0" />
                <circle cx="12" cy="6" r="1.6" />
                <line x1="12" y1="7.6" x2="12" y2="9" />
              </svg>
              <span className={styles.opsHeadLabel}>Next Catering</span>
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
            ) : weekCateringCount === null ? (
              <p className={styles.opsLabel}>—</p>
            ) : (
              <p className={styles.opsLabel}>No upcoming orders</p>
            )}
            <p className={styles.opsWeekLine}>
              This Week<br />
              <strong>{weekCateringCount ?? "—"} Orders</strong>
            </p>
            <Link href="/operations/catering-orders" className={styles.opsViewLink}>
              View <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </section>

      <section>
        <p className={styles.sectionLabel}>SALES</p>
        <div className={styles.salesCard}>
          <div className={styles.salesTop}>
            <div className={styles.salesBlock}>
              <p className={styles.salesLabel}>Today Sales</p>
              <p className={styles.salesValue}>
                {todaySales === null ? "—" : fmtCurrency(todaySales)}
              </p>
            </div>
            <div className={styles.salesDivider} aria-hidden="true" />
            <div className={styles.salesBlock}>
              <p className={styles.salesLabel}>Target Sales</p>
              <p className={styles.salesValue}>{fmtCurrency(dailyTarget)}</p>
            </div>
          </div>
          {dailyTarget > 0 && (
            <div className={styles.salesProgressWrap}>
              <div
                className={styles.salesProgressTrack}
                style={{ "--sales-progress": `${salesPct ?? 0}%` } as React.CSSProperties}
              >
                <div className={styles.salesProgressFill} />
              </div>
              {todaySales !== null && salesPct !== null && (
                <p className={styles.salesProgressPct}>{salesPct}% of target</p>
              )}
            </div>
          )}
        </div>
      </section>

      <section>
        <p className={styles.sectionLabel}>TODAY&rsquo;S TEAM</p>
        <div className={styles.teamCard}>
          <div className={styles.teamRow}>
            <div className={styles.teamBlock}>
              <svg className={styles.teamIcon} width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9a4 4 0 1 1 5-3 4 4 0 1 1 5 3v6H6V9z" />
                <line x1="6" y1="15" x2="18" y2="15" />
                <line x1="7" y1="19" x2="17" y2="19" />
              </svg>
              <p className={styles.teamValue}>{kitchenStaff ?? "—"}</p>
              <p className={styles.teamLabel}>Kitchen</p>
            </div>
            <div className={styles.teamDivider} />
            <div className={styles.teamBlock}>
              <svg className={styles.teamIcon} width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="7" r="3.2" />
                <path d="M5 21v-2a5 5 0 0 1 4-4.9" />
                <path d="M19 21v-2a5 5 0 0 0-4-4.9" />
                <path d="M10 12l2 2 2-2" />
              </svg>
              <p className={styles.teamValue}>{hallStaff ?? "—"}</p>
              <p className={styles.teamLabel}>Hall</p>
            </div>
          </div>
          <Link href="/scheduling/roster" className={styles.teamFooter}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
              <circle cx="10" cy="7" r="4" />
              <path d="M21 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <span>{team} Staff Scheduled</span>
            <span className={styles.teamChev} aria-hidden="true">›</span>
          </Link>
        </div>
      </section>

      <div className={styles.note}>
        <span className={styles.noteIcon} aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </span>
        <p className={styles.noteBody}>
          Keep the team informed and the floor ready.<br />
          You&rsquo;ve got this!
        </p>
      </div>
    </div>
    </>
  );
}
