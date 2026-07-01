"use client";

import Link from "next/link";
import { useEffect, useState, useCallback, useMemo } from "react";
import { collection, doc, getDocs, getDoc, type Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { emailToUsername } from "@/lib/username";
import { fetchCateringOrders, type CateringOrder } from "@/lib/catering-orders";
import {
  fetchReservationsForDate,
  serviceFor,
  type Reservation,
} from "@/lib/reservations";
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

const SYDNEY_TZ = "Australia/Sydney";

function sydneyTodayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: SYDNEY_TZ });
}

function isoDateToMonday(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = (dt.getUTCDay() + 6) % 7; // Mon=0
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
  // "yurina" → "Yuri" is the screenshot expectation but we can't infer
  // a nickname from the username alone. Default to capitalised username.
  return username.charAt(0).toUpperCase() + username.slice(1);
}

export default function ManagerDashboard() {
  const { user } = useAuth();
  const [firstName, setFirstName] = useState<string>("");
  const [attention, setAttention] = useState<AttentionCounts>({
    holidayRequests: 0, availabilityChanges: 0, newOnboarding: 0, visaExpiring: 0,
  });

  // Square / system_yurica live data
  const [todaySales, setTodaySales] = useState<number | null>(null);
  const [reservations, setReservations] = useState<Reservation[] | null>(null);
  const [cateringOrders, setCateringOrders] = useState<CateringOrder[] | null>(null);
  const [kitchenStaff, setKitchenStaff] = useState<number | null>(null);
  const [hallStaff, setHallStaff] = useState<number | null>(null);

  const todayKey = sydneyTodayKey();
  const todayDow = (() => {
    const [y, m, d] = todayKey.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  })();
  const dailyTarget = DAILY_TARGETS[todayDow] ?? 0;

  useEffect(() => {
    setFirstName(firstNameFromUsername(emailToUsername(user?.email)));
  }, [user]);

  // Attention Required counts
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(getDb(), "staff_onboarding"));
        let holidayRequests = 0, availabilityChanges = 0, newOnboarding = 0, visaExpiring = 0;
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
  }, []);

  // Square + system_yurica + roster
  const fetchLiveData = useCallback(async () => {
    // Square today-stats
    try {
      const res = await fetch(`/api/square/today-stats?date=${todayKey}`);
      if (res.ok) {
        const d = await res.json();
        setTodaySales(d.todaySales ?? null);
      }
    } catch { /* ignore */ }

    // Reservations (real data via Quandoo/SevenRooms)
    try {
      const res = await fetchReservationsForDate(user, todayKey, "northsydney");
      setReservations(res);
    } catch { /* ignore */ }

    // Catering orders (real data via Square)
    try {
      const orders = await fetchCateringOrders(user);
      setCateringOrders(orders);
    } catch { /* ignore */ }

    // Roster: count kitchen / hall from today's rosters_published doc
    try {
      const weekKey = isoDateToMonday(todayKey);
      const rSnap = await getDoc(doc(getDb(), "rosters_published", weekKey));
      if (rSnap.exists()) {
        const rData = rSnap.data() as {
          assignments?: Record<string, Record<string, Record<string, string>>>;
        };
        const dayAssign = rData.assignments?.[todayKey] ?? {};
        const allUids = new Set<string>();
        for (const meal of Object.values(dayAssign)) {
          for (const uid of Object.keys(meal)) allUids.add(uid);
        }
        // Fetch staff roles to split kitchen vs hall
        const staffSnap = await getDocs(collection(getDb(), "staff_onboarding"));
        const roleMap = new Map<string, string>();
        for (const sd of staffSnap.docs) roleMap.set(sd.id, (sd.data().role as string) ?? "staff");
        let kitchen = 0, hall = 0;
        for (const uid of allUids) {
          const role = roleMap.get(uid) ?? "staff";
          if (role === "chef" || role === "kitchen") kitchen++;
          else hall++;
        }
        setKitchenStaff(kitchen);
        setHallStaff(hall);
      }
    } catch { /* ignore */ }
  }, [todayKey]);

  useEffect(() => {
    fetchLiveData();
    const id = setInterval(fetchLiveData, 60_000);
    return () => clearInterval(id);
  }, [fetchLiveData]);

  // Reservation counts from real data
  const resCounts = useMemo(() => {
    if (!reservations) return null;
    const active = reservations.filter(
      (r) => r.status !== "cancelled" && r.status !== "no-show",
    );
    const totalPax = active.reduce((s, r) => s + r.count, 0);
    const totalBookings = active.length;
    return { totalPax, totalBookings };
  }, [reservations]);

  // Today's catering orders count
  const todayCateringCount = useMemo(() => {
    if (!cateringOrders) return null;
    return cateringOrders.filter(
      (o) => o.deliveryDateISO === todayKey && o.status !== "CANCELLED",
    ).length;
  }, [cateringOrders, todayKey]);

  const attentionTotal =
    attention.holidayRequests + attention.availabilityChanges +
    attention.newOnboarding + attention.visaExpiring;

  const greeting = greetingForNow();
  const team = (kitchenStaff ?? 0) + (hallStaff ?? 0);

  return (
    <div className={styles.page}>
      {/* Greeting */}
      <header className={styles.greeting}>
        <h1 className={styles.greetingTitle}>
          {greeting}, {firstName || "there"}
        </h1>
        <p className={styles.greetingRole}>Store Manager</p>
      </header>

      {/* Attention Required */}
      <section>
        <div className={styles.sectionHead}>
          <p className={styles.sectionLabel}>ATTENTION REQUIRED</p>
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

          <Link href="/attention-required?filter=onboarding" className={styles.attentionCell}>
            <svg className={styles.attentionIcon} width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="8.5" cy="7" r="4" />
              <line x1="20" y1="8" x2="20" y2="14" />
              <line x1="23" y1="11" x2="17" y2="11" />
            </svg>
            <p className={styles.attentionValue}>{attention.newOnboarding}</p>
            <p className={styles.attentionLabel}>New<br />Onboarding</p>
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

      {/* Today's Operations */}
      <section>
        <p className={styles.sectionLabel}>TODAY&rsquo;S OPERATIONS</p>
        <div className={styles.opsRow}>
          <Link href="/operations/reservations" className={styles.opsCard}>
            <svg className={styles.opsIcon} width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <p className={styles.opsValue}>
              {resCounts ? resCounts.totalPax : "—"}
              {resCounts !== null && <span className={styles.opsUnit}> Pax</span>}
            </p>
            <p className={styles.opsLabel}>{resCounts ? `${resCounts.totalBookings} Reservations` : "Reservations"}</p>
          </Link>

          <Link href="/operations/catering-orders" className={styles.opsCard}>
            <svg className={styles.opsIcon} width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 18h18" />
              <path d="M5 18a7 7 0 0 1 14 0" />
              <circle cx="12" cy="6" r="1.6" />
              <line x1="12" y1="7.6" x2="12" y2="9" />
            </svg>
            <p className={styles.opsValue}>
              {todayCateringCount !== null ? todayCateringCount : "—"}
            </p>
            <p className={styles.opsLabel}>Catering Orders</p>
          </Link>
        </div>
      </section>

      {/* Sales */}
      <section>
        <p className={styles.sectionLabel}>SALES</p>
        <div className={styles.salesCard}>
          <div className={styles.salesBlock}>
            <p className={styles.salesLabel}>Today Sales</p>
            <p className={styles.salesValue}>
              {todaySales === null ? "—" : fmtCurrency(todaySales)}
            </p>
          </div>
          <div className={styles.salesDivider} />
          <div className={styles.salesBlock}>
            <p className={styles.salesLabel}>Target Sales</p>
            <p className={styles.salesValue}>{fmtCurrency(dailyTarget)}</p>
          </div>
        </div>
      </section>

      {/* Today's Team */}
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

      {/* Footer note */}
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
  );
}
