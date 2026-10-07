"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { User } from "firebase/auth";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import DashboardReadyMarker from "@/components/DashboardReadyMarker";
import { emailToUsername } from "@/lib/username";
import { fetchReservationsForDate } from "@/lib/reservations";
import {
  readManagerDashCache,
  writeManagerDashCache,
  type ManagerDashCache,
} from "@/lib/manager-dash-cache";
import type { ManagerDashServerSnapshot } from "@/lib/manager-dash-server";
import { isoMondayOf, sydneyTodayKey } from "@/lib/sydney-date";
import { dailySalesTarget, targetPct, WEEKLY_SALES_TARGET } from "@/lib/sales-targets";
import { fetchDocumentSignatures, SIGNABLE_DOCUMENT_KEYS } from "@/lib/document-signatures";
import { CHEF_NAV, navShortcuts } from "@/lib/sidebar-nav";
import styles from "./ChefDashboard.module.css";

/**
 * The kitchen's dashboard.
 *
 * Was the store manager's screen with the scheduling queue switched off by a
 * prop. The two have since been specced apart — the kitchen leads with the
 * three numbers that decide a service (covers booked, catering leaving today,
 * categories off the menu) and carries its own shortcut list — so it is its
 * own component and the flag is gone from the manager's.
 *
 * It still shares the manager's cache and server snapshot, because the two
 * screens open on the same day's sales and the same reservation count, and a
 * second cache would only mean fetching them twice.
 */

/** 0 = Monday … 6 = Sunday. How far into its week a date key sits. */
function weekDayOffsetOf(dateKey: string, monday: string): number {
  if (!dateKey || !monday) return 0;
  const ms = Date.parse(`${dateKey}T00:00:00Z`) - Date.parse(`${monday}T00:00:00Z`);
  return Math.min(6, Math.max(0, Math.round(ms / 86_400_000)));
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

async function authHeader(user: User | null | undefined): Promise<HeadersInit> {
  if (!user) return {};
  return { Authorization: `Bearer ${await user.getIdToken()}` };
}

type StoredRequest = { status?: string };
type StaffDoc = {
  role?: string;
  holidayRequests?: StoredRequest[];
  availabilityRequests?: StoredRequest[];
};

type TodayCatering = { count: number; firstTime: string | null };

async function fetchTodayCatering(
  user: User | null | undefined,
  dateKey: string,
): Promise<TodayCatering> {
  const res = await fetch(`/api/catering-orders/summary?date=${encodeURIComponent(dateKey)}`, {
    cache: "no-store",
    headers: await authHeader(user),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { count: 0, firstTime: null };
  return {
    count: typeof data.todayCount === "number" ? data.todayCount : 0,
    firstTime: typeof data.todayFirstTime === "string" ? data.todayFirstTime : null,
  };
}

/**
 * How many categories are off the menu today.
 *
 * A missing doc means nothing is sold out — the collection is keyed by date and
 * resets itself by simply not having a document for the new day.
 */
async function fetchSoldOutCount(dateKey: string): Promise<number> {
  const snap = await getDoc(doc(getDb(), "sold_out_daily", dateKey));
  if (!snap.exists()) return 0;
  const ids = (snap.data() as { soldOutIds?: unknown }).soldOutIds;
  return Array.isArray(ids) ? ids.length : 0;
}

/** Pending holiday and availability requests, owners excluded. */
async function fetchScheduleRequests(): Promise<{ holiday: number; availability: number }> {
  const snap = await getDocs(collection(getDb(), "staff_onboarding"));
  let holiday = 0;
  let availability = 0;
  for (const d of snap.docs) {
    const data = d.data() as StaffDoc;
    if (data.role === "owner") continue;
    for (const r of data.holidayRequests ?? []) if (r.status === "pending") holiday++;
    for (const r of data.availabilityRequests ?? []) if (r.status === "pending") availability++;
  }
  return { holiday, availability };
}

/**
 * Icons for the Quick Access rows, keyed by the menu label they belong to.
 *
 * Keyed by label rather than by index so re-ordering the menu cannot silently
 * hand Payslips the calendar. A label with no entry here falls back to the
 * generic chevron-only row rather than breaking the list.
 */
const QUICK_ICONS: Record<string, ReactNode> = {
  Operations: (
    <>
      <path d="M3 2v7a3 3 0 0 0 3 3 3 3 0 0 0 3-3V2" />
      <line x1="6" y1="12" x2="6" y2="22" />
      <path d="M17 2c-1.7 1.2-2.5 3-2.5 5.5S15.3 12 17 13v9" />
    </>
  ),
  Scheduling: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </>
  ),
  Team: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    </>
  ),
  Payslips: (
    <>
      <rect x="2" y="6" width="20" height="13" rx="2" />
      <path d="M2 11h20" />
      <circle cx="12" cy="15" r="1.5" />
    </>
  ),
  "Documents & Training": (
    <>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </>
  ),
};

/** The five menu groups, so the shortcuts and the menu cannot drift apart. */
const QUICK_ACCESS = navShortcuts(CHEF_NAV);

function TodayCard({
  href,
  label,
  value,
  sub,
  children,
}: {
  href: string;
  label: string;
  value: ReactNode;
  sub: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={styles.todayCard}>
      <span className={styles.todayHead}>
        <span className={styles.todayIcon} aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {children}
          </svg>
        </span>
        <span className={styles.todayLabel}>{label}</span>
        <span className={styles.todayChev} aria-hidden="true">›</span>
      </span>
      <span className={styles.todayValue}>{value}</span>
      <span className={styles.todaySub}>{sub}</span>
    </Link>
  );
}

function SalesRow({
  label,
  value,
  targetLabel,
  target,
  pct,
  accentPct,
  children,
}: {
  label: string;
  value: number | null;
  targetLabel: string;
  target: number;
  pct: number | null;
  accentPct?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={styles.salesRow}>
      <div className={styles.salesRowTop}>
        <span className={styles.salesIcon} aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {children}
          </svg>
        </span>
        <span className={styles.salesBlock}>
          <span className={styles.salesLabel}>{label}</span>
          <span className={`${styles.salesValue} ${styles.salesValueAccent}`}>
            {value === null ? "—" : fmtCurrency(value)}
          </span>
        </span>
        <span className={styles.salesDivider} aria-hidden="true" />
        <span className={styles.salesBlock}>
          <span className={styles.salesLabel}>{targetLabel}</span>
          <span className={styles.salesValue}>{fmtCurrency(target)}</span>
        </span>
        <span className={styles.salesPctBlock}>
          <span className={`${styles.salesPct} ${accentPct ? styles.salesPctAccent : ""}`}>
            {pct === null ? "—" : `${pct}%`}
          </span>
          <span className={styles.salesPctLabel}>of target</span>
        </span>
      </div>
      <div
        className={styles.salesTrack}
        style={{ "--sales-progress": `${pct ?? 0}%` } as React.CSSProperties}
      >
        <div className={styles.salesFill} />
      </div>
    </div>
  );
}

function AttentionCard({
  href,
  label,
  value,
  sub,
}: {
  href: string;
  label: string;
  value: ReactNode;
  sub: string;
}) {
  return (
    <Link href={href} className={styles.attentionCard}>
      <span className={styles.attentionHead}>
        <span className={styles.attentionLabel}>{label}</span>
        <span className={styles.attentionChev} aria-hidden="true">›</span>
      </span>
      <span className={styles.attentionValue}>{value}</span>
      <span className={styles.attentionSub}>{sub}</span>
    </Link>
  );
}

export default function ChefDashboard({
  initialCache = null,
}: {
  /** Server-fetched snapshot — same on SSR and client to avoid hydration mismatch. */
  initialCache?: ManagerDashCache | null;
} = {}) {
  const { user, loading: authLoading } = useAuth();

  const [todayKey, setTodayKey] = useState(initialCache?.date ?? "");
  const [greeting, setGreeting] = useState("");
  useEffect(() => {
    if (!todayKey) setTodayKey(sydneyTodayKey());
    setGreeting(greetingForNow());
  }, [todayKey]);

  const [firstName, setFirstName] = useState("");
  useEffect(() => {
    setFirstName(firstNameFromUsername(emailToUsername(user?.email)));
  }, [user]);

  const [todaySales, setTodaySales] = useState<number | null>(initialCache?.todaySales ?? null);
  const [resCounts, setResCounts] = useState<{ pax: number; bookings: number } | null>(
    typeof initialCache?.totalPax === "number" && typeof initialCache?.totalBookings === "number"
      ? { pax: initialCache.totalPax, bookings: initialCache.totalBookings }
      : null,
  );
  const [catering, setCatering] = useState<TodayCatering | null>(null);
  const [soldOut, setSoldOut] = useState<number | null>(null);
  const [weekDaily, setWeekDaily] = useState<number[] | null>(null);
  const [requests, setRequests] = useState<{ holiday: number; availability: number } | null>(null);
  const [unsignedCount, setUnsignedCount] = useState<number | null>(null);

  /** Paint the day's sales and covers from cache, then from the server snapshot. */
  useEffect(() => {
    const date = todayKey || sydneyTodayKey();
    const apply = (cache: ManagerDashCache | null) => {
      if (!cache) return;
      if (typeof cache.todaySales === "number") setTodaySales(cache.todaySales);
      if (typeof cache.totalPax === "number" && typeof cache.totalBookings === "number") {
        setResCounts({ pax: cache.totalPax, bookings: cache.totalBookings });
      }
    };
    apply(readManagerDashCache(date));

    let cancelled = false;
    void fetch(`/api/dashboard/manager-snapshot?date=${encodeURIComponent(date)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ManagerDashServerSnapshot | null) => {
        if (cancelled || !data?.cache) return;
        writeManagerDashCache(data.cache);
        apply(data.cache);
      })
      .catch(() => {
        /* the live fetch below still runs */
      });
    return () => {
      cancelled = true;
    };
  }, [todayKey]);

  const fetchLive = useCallback(async () => {
    const monday = isoMondayOf(todayKey);
    const [sales, reservations, cateringToday, soldOutCount, week] = await Promise.allSettled([
      fetch(`/api/square/today-sales-brief?date=${encodeURIComponent(todayKey)}`).then(
        async (res) => {
          if (!res.ok) return null;
          const d = await res.json();
          return typeof d.todaySales === "number" ? d.todaySales : null;
        },
      ),
      fetchReservationsForDate(user, todayKey, "northsydney"),
      fetchTodayCatering(user, todayKey),
      fetchSoldOutCount(todayKey),
      fetch(`/api/square/weekly-daily?weekStart=${encodeURIComponent(monday)}`).then(
        async (res) => {
          if (!res.ok) return null;
          const d = (await res.json()) as { thisWeek?: { daily?: number[] } };
          return Array.isArray(d.thisWeek?.daily) ? d.thisWeek.daily : null;
        },
      ),
    ]);

    let sold: number | null = null;
    if (sales.status === "fulfilled") {
      sold = sales.value;
      setTodaySales(sold);
    }

    let pax: number | null = null;
    let bookings: number | null = null;
    if (reservations.status === "fulfilled") {
      const active = reservations.value.filter(
        (r) => r.status !== "cancelled" && r.status !== "no-show",
      );
      pax = active.reduce((s, r) => s + r.count, 0);
      bookings = active.length;
      setResCounts({ pax, bookings });
    }

    if (cateringToday.status === "fulfilled") setCatering(cateringToday.value);
    if (soldOutCount.status === "fulfilled") setSoldOut(soldOutCount.value);
    if (week.status === "fulfilled") setWeekDaily(week.value);

    // Only the fields this screen is the live source for. The rest of the
    // manager cache is left as the snapshot wrote it rather than overwritten
    // with nulls the kitchen never fetched.
    const existing = readManagerDashCache(todayKey);
    writeManagerDashCache({
      date: todayKey,
      todaySales: sold,
      totalPax: pax,
      totalBookings: bookings,
      nextCatering: existing?.nextCatering ?? null,
      weekCateringCount: existing?.weekCateringCount ?? null,
      kitchenStaff: existing?.kitchenStaff ?? null,
      hallStaff: existing?.hallStaff ?? null,
    });
  }, [todayKey, user]);

  useEffect(() => {
    if (!todayKey || !user) return;
    // Cached numbers stay on screen while the live ones come in.
    void fetchLive();
    const id = setInterval(fetchLive, 60_000);
    return () => clearInterval(id);
  }, [fetchLive, todayKey, user]);

  // Read once, not on the minute with the rest. This enumerates the whole
  // staff collection to count two kinds of pending request — one read per
  // employee — and a request submitted while the kitchen screen happens to be
  // open is not worth paying that every sixty seconds. Same cadence as the
  // manager's screen, which counts the same queue.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const counts = await fetchScheduleRequests();
        if (!cancelled) setRequests(counts);
      } catch {
        // Leave the card at "—" rather than claiming an empty queue.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const signatures = await fetchDocumentSignatures(user);
        if (!cancelled) {
          setUnsignedCount(SIGNABLE_DOCUMENT_KEYS.filter((key) => !signatures[key]).length);
        }
      } catch {
        // Leave the row at "—" on a read failure. A "1 outstanding" that
        // signing cannot clear is worse than not knowing.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const dailyTarget = dailySalesTarget(todayKey);
  const salesPct = useMemo(() => targetPct(todaySales, dailyTarget), [todaySales, dailyTarget]);

  /**
   * Week to date, with today taken from the live day figure rather than the
   * weekly snapshot.
   *
   * The same substitution the owner dashboard makes, and for the same reason:
   * the weekly endpoint's paid-sales half is a ten-minute cache, so a ticket
   * being paid drops out of the live open total before the cache picks it up
   * and the week figure sags for minutes on every payment. Only today is
   * substituted — the earlier days of the week are settled and the snapshot is
   * the better source for them.
   */
  const weeklySales = useMemo(() => {
    if (!weekDaily || !todayKey) return null;
    const offset = weekDayOffsetOf(todayKey, isoMondayOf(todayKey));
    const beforeToday = weekDaily.slice(0, offset).reduce((sum, n) => sum + (n || 0), 0);
    const today = todaySales ?? weekDaily[offset] ?? 0;
    return Math.round((beforeToday + today) * 100) / 100;
  }, [weekDaily, todayKey, todaySales]);

  const weeklyPct = useMemo(
    () => targetPct(weeklySales, WEEKLY_SALES_TARGET),
    [weeklySales],
  );

  const requestTotal = requests ? requests.holiday + requests.availability : null;
  const attentionTotal = (requestTotal ?? 0) + (unsignedCount ?? 0);

  return (
    <>
      <DashboardReadyMarker when={!authLoading} />
      <div className={styles.page}>
        <header className={styles.greeting}>
          <h1 className={styles.greetingTitle}>
            {greeting || "Hello"}, {firstName || "there"}
          </h1>
          <p className={styles.greetingRole}>Head Chef</p>
        </header>

        <section>
          <p className={styles.sectionLabel}>TODAY</p>
          <div className={styles.todayRow}>
            <TodayCard
              href="/operations/reservations"
              label="Reservations"
              value={resCounts ? resCounts.bookings : "—"}
              sub={resCounts ? `${resCounts.pax} pax` : "pax"}
            >
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </TodayCard>

            <TodayCard
              href="/operations/catering-orders"
              label="Catering"
              value={catering ? catering.count : "—"}
              sub={catering?.firstTime ? `${catering.firstTime} pickup` : "no pickup"}
            >
              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <path d="M16 10a4 4 0 0 1-8 0" />
            </TodayCard>

            <TodayCard
              href="/operations/daily-sold-out"
              label="Sold Out"
              value={soldOut === null ? "—" : soldOut}
              /* The collection holds category ids, not item ids — the page this
                 links to counts them as categories, so this card says the same
                 thing rather than promising a number of dishes. */
              sub="categories"
            >
              <circle cx="12" cy="12" r="9" />
              <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" />
            </TodayCard>
          </div>
        </section>

        <section>
          <p className={styles.sectionLabel}>SALES</p>
          <div className={styles.salesCard}>
            <SalesRow
              label="Today Sales"
              value={todaySales}
              targetLabel="Target Sales"
              target={dailyTarget}
              pct={salesPct}
              accentPct
            >
              <line x1="6" y1="20" x2="6" y2="13" />
              <line x1="12" y1="20" x2="12" y2="8" />
              <line x1="18" y1="20" x2="18" y2="4" />
            </SalesRow>

            <div className={styles.salesHairline} aria-hidden="true" />

            <SalesRow
              label="This Week WTD"
              value={weeklySales}
              targetLabel="Weekly Target"
              target={WEEKLY_SALES_TARGET}
              pct={weeklyPct}
            >
              <polyline points="3 17 9 11 13 15 21 7" />
              <polyline points="15 7 21 7 21 13" />
            </SalesRow>
          </div>
        </section>

        <section>
          <div className={styles.sectionHead}>
            <p className={styles.sectionLabel}>NEEDS ATTENTION</p>
            <span className={styles.sectionBadge}>{attentionTotal}</span>
          </div>
          <div className={styles.attentionRow}>
            <AttentionCard
              href="/attention-required"
              label="Schedule Requests"
              value={requestTotal === null ? "—" : requestTotal}
              sub={
                requests
                  ? `${requests.holiday} Holiday • ${requests.availability} Availability`
                  : "Holiday • Availability"
              }
            />
            <AttentionCard
              href="/staff/documents"
              label="Signatures Required"
              value={unsignedCount === null ? "—" : unsignedCount}
              sub="Training / Documents"
            />
          </div>
        </section>

        <section>
          <p className={styles.sectionLabel}>QUICK ACCESS</p>
          <nav className={styles.quickList}>
            {QUICK_ACCESS.map(({ label, href }) => (
              <Link key={label} href={href} className={styles.quickRow}>
                <span className={styles.quickIcon} aria-hidden="true">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {QUICK_ICONS[label]}
                  </svg>
                </span>
                <span className={styles.quickLabel}>{label}</span>
                <span className={styles.quickChev} aria-hidden="true">›</span>
              </Link>
            ))}
          </nav>
        </section>
      </div>
    </>
  );
}
