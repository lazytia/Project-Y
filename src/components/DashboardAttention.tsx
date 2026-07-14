"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  type Timestamp,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { isNoticeGivenActive, isReadyToTerminate, noticeLastWorkingDay } from "@/lib/notice-last-day";
import styles from "./DashboardAttention.module.css";

/**
 * Owner Dashboard — top-of-screen attention card. Surfaces only *today's*
 * new items across six operational streams (catering, sold-out menu, new
 * onboarding requests, notice given, HR notes, cash payments) and lets the
 * owner "Noted" an individual row (or all of them). Noted state is per-
 * browser in localStorage keyed by today's date, so it resets naturally
 * overnight when the date rolls over.
 */

const SYDNEY_TZ = "Australia/Sydney";
const STORAGE_KEY = "y.dashboardAttentionNoted";

type AttentionKind =
  | "catering"
  | "soldOut"
  | "newEmployee"
  | "noticeGiven"
  | "readyToTerminate"
  | "hrNotes"
  | "cashPayment";

type AttentionRow = {
  kind: AttentionKind;
  count: number;
  title: string;
  subtitle: string;
  href: string;
  icon: React.ReactNode;
};

type NotedMap = Partial<Record<AttentionKind, string>>;

/* ── date helpers ── */

function sydneyTodayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: SYDNEY_TZ });
}

function startOfSydneyToday(): Date {
  const key = sydneyTodayKey();
  const [y, m, d] = key.split("-").map(Number);
  // Anchor at UTC 00:00 of the Sydney date. Straddles DST slightly but
  // is fine for a "created today" filter — worst case we miss items
  // created in the last few hours before midnight Sydney.
  return new Date(Date.UTC(y, m - 1, d));
}

function tsDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object" && v !== null && "toDate" in v) {
    try {
      return (v as Timestamp).toDate();
    } catch {
      return null;
    }
  }
  return null;
}

/* ── noted state persistence ── */

function readNoted(): NotedMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as NotedMap) : {};
  } catch {
    return {};
  }
}

function writeNoted(next: NotedMap) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode — ignore */
  }
}

/* ── data loaders ── */

async function loadCateringCount(sinceUtc: Date, todayKey: string): Promise<number> {
  const snap = await getDocs(collection(getDb(), "catering_orders"));
  return snap.docs.reduce((acc, d) => {
    const data = d.data();
    const created = tsDate(data.createdAt);
    if (!created || created < sinceUtc) return acc;
    // Filter out bulk-backfilled historical orders. Yurica's Square
    // sync stamps createdAt = serverTimestamp() at import time, so a
    // one-off catalogue rebuild puts every past order under today's
    // timestamp and floods the attention card. Requiring the delivery
    // date to be today or in the future rules those out — a genuinely
    // new catering booking always has a delivery date >= today.
    const delivery = typeof data.deliveryDateISO === "string" ? data.deliveryDateISO : "";
    if (delivery && delivery < todayKey) return acc;
    return acc + 1;
  }, 0);
}

async function loadSoldOutCount(todayKey: string): Promise<number> {
  const snap = await getDoc(doc(getDb(), "sold_out_daily", todayKey));
  if (!snap.exists()) return 0;
  const ids = (snap.data().soldOutIds as string[] | undefined) ?? [];
  return ids.length;
}

async function loadNewEmployeeCount(): Promise<number> {
  // Submitted onboarding still waiting on owner approval. Mirror the
  // /people/onboarding page's isApproved rule so the counts match.
  const snap = await getDocs(collection(getDb(), "staff_onboarding"));
  return snap.docs.reduce((acc, d) => {
    const raw = d.data();
    if (raw.role === "owner") return acc;
    const status = String(raw.status ?? "").toLowerCase();
    const isApproved = status === "approved" || status === "active" || !!raw.approvedAt;
    if (isApproved) return acc;
    const completed = typeof raw.completedStep === "number" ? raw.completedStep : 0;
    return completed >= 7 ? acc + 1 : acc;
  }, 0);
}

async function loadNoticeGivenCount(): Promise<number> {
  const snap = await getDocs(
    query(collection(getDb(), "notice_given"), orderBy("createdAt", "desc")),
  );
  return snap.docs.reduce((acc, d) => {
    const last = noticeLastWorkingDay(d.data() as { finalShiftDate?: string; lastWorkingDay?: string });
    return isNoticeGivenActive(last) ? acc + 1 : acc;
  }, 0);
}

async function loadReadyToTerminateCount(): Promise<number> {
  const snap = await getDocs(
    query(collection(getDb(), "notice_given"), orderBy("createdAt", "desc")),
  );
  return snap.docs.reduce((acc, d) => {
    const last = noticeLastWorkingDay(d.data() as { finalShiftDate?: string; lastWorkingDay?: string });
    return isReadyToTerminate(last) ? acc + 1 : acc;
  }, 0);
}

async function loadHrNotesCount(sinceUtc: Date): Promise<number> {
  const snap = await getDocs(
    query(collection(getDb(), "hr_notes"), orderBy("createdAt", "desc")),
  );
  return snap.docs.reduce((acc, d) => {
    const created = tsDate(d.data().createdAt);
    return created && created >= sinceUtc ? acc + 1 : acc;
  }, 0);
}

async function loadCashPaymentCount(sinceUtc: Date): Promise<number> {
  const snap = await getDocs(
    query(collection(getDb(), "cash_payments"), orderBy("createdAt", "desc")),
  );
  return snap.docs.reduce((acc, d) => {
    const created = tsDate(d.data().createdAt);
    return created && created >= sinceUtc ? acc + 1 : acc;
  }, 0);
}

/* ── icons ── */

function CalendarIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function ClipboardIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1z" />
      <path d="M8 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <line x1="8" y1="11" x2="16" y2="11" />
      <line x1="8" y1="15" x2="14" y2="15" />
    </svg>
  );
}

function UserPlusIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <line x1="22" y1="11" x2="16" y2="11" />
    </svg>
  );
}

function UserClockIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="7" r="4" />
      <path d="M2 21v-2a4 4 0 0 1 4-4h5" />
      <circle cx="17.5" cy="16.5" r="4.5" />
      <polyline points="17.5 14.5 17.5 16.5 19 17.5" />
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

function DollarIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <text x="12" y="16" textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor" stroke="none">$</text>
    </svg>
  );
}

function StopCircleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="8" y1="8" x2="16" y2="16" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  );
}

/* ── main component ── */

export default function DashboardAttention() {
  const router = useRouter();
  const [counts, setCounts] = useState<Partial<Record<AttentionKind, number>> | null>(null);
  const [noted, setNoted] = useState<NotedMap>({});
  const [todayKey, setTodayKey] = useState<string>("");

  useEffect(() => {
    setTodayKey(sydneyTodayKey());
    setNoted(readNoted());
  }, []);

  useEffect(() => {
    if (!todayKey) return;
    let cancelled = false;
    (async () => {
      const sinceUtc = startOfSydneyToday();
      const [catering, soldOut, newEmp, notice, ready, hr, cash] = await Promise.all([
        loadCateringCount(sinceUtc, todayKey).catch(() => 0),
        loadSoldOutCount(todayKey).catch(() => 0),
        loadNewEmployeeCount().catch(() => 0),
        loadNoticeGivenCount().catch(() => 0),
        loadReadyToTerminateCount().catch(() => 0),
        loadHrNotesCount(sinceUtc).catch(() => 0),
        loadCashPaymentCount(sinceUtc).catch(() => 0),
      ]);
      if (cancelled) return;
      setCounts({
        catering,
        soldOut,
        newEmployee: newEmp,
        noticeGiven: notice,
        readyToTerminate: ready,
        hrNotes: hr,
        cashPayment: cash,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [todayKey]);

  const rows: AttentionRow[] = useMemo(() => {
    if (!counts) return [];
    const build: AttentionRow[] = [
      {
        kind: "catering",
        count: counts.catering ?? 0,
        title: "New Catering Order",
        subtitle: `${counts.catering ?? 0} new order${counts.catering === 1 ? "" : "s"} received`,
        href: "/operations/catering-orders",
        icon: <CalendarIcon />,
      },
      {
        kind: "soldOut",
        count: counts.soldOut ?? 0,
        title: "Daily Sold Out",
        subtitle: `${counts.soldOut ?? 0} item${counts.soldOut === 1 ? "" : "s"} marked sold out today`,
        href: "/operations/daily-sold-out",
        icon: <ClipboardIcon />,
      },
      {
        kind: "newEmployee",
        count: counts.newEmployee ?? 0,
        title: "Add New Employee Request",
        subtitle: `${counts.newEmployee ?? 0} request${counts.newEmployee === 1 ? "" : "s"} pending approval`,
        href: "/people/onboarding",
        icon: <UserPlusIcon />,
      },
      {
        kind: "noticeGiven",
        count: counts.noticeGiven ?? 0,
        title: "Notice Given",
        subtitle: `${counts.noticeGiven ?? 0} employee${counts.noticeGiven === 1 ? "" : "s"} have given notice`,
        href: "/people/notice-given",
        icon: <UserClockIcon />,
      },
      {
        kind: "readyToTerminate",
        count: counts.readyToTerminate ?? 0,
        title: "Ready to Terminate",
        subtitle: `${counts.readyToTerminate ?? 0} employee${counts.readyToTerminate === 1 ? "" : "s"} awaiting owner confirmation`,
        href: "/people/active?tab=ready",
        icon: <StopCircleIcon />,
      },
      {
        kind: "hrNotes",
        count: counts.hrNotes ?? 0,
        title: "HR Notes",
        subtitle: `${counts.hrNotes ?? 0} new note${counts.hrNotes === 1 ? "" : "s"} added`,
        href: "/people/hr-notes",
        icon: <NoteIcon />,
      },
      {
        kind: "cashPayment",
        count: counts.cashPayment ?? 0,
        title: "Cash Payment",
        subtitle: `${counts.cashPayment ?? 0} new cash payment${counts.cashPayment === 1 ? "" : "s"} recorded`,
        href: "/people/cash-payments",
        icon: <DollarIcon />,
      },
    ];
    return build.filter((r) => r.count > 0 && noted[r.kind] !== todayKey);
  }, [counts, noted, todayKey]);

  if (!counts || rows.length === 0) return null;

  function noteOne(kind: AttentionKind) {
    const next: NotedMap = { ...noted, [kind]: todayKey };
    setNoted(next);
    writeNoted(next);
  }

  function noteAll() {
    const next: NotedMap = { ...noted };
    for (const r of rows) next[r.kind] = todayKey;
    setNoted(next);
    writeNoted(next);
  }

  return (
    <section className={styles.card}>
      <header className={styles.header}>
        <p className={styles.title}>ATTENTION</p>
        <button
          type="button"
          className={styles.notedAll}
          onClick={noteAll}
          aria-label="Mark all as noted"
        >
          Noted All <CheckCircleIcon />
        </button>
      </header>

      <ul className={styles.list}>
        {rows.map((row, idx) => (
          <li key={row.kind} className={idx === 0 ? styles.rowFirst : styles.row}>
            <button
              type="button"
              className={styles.rowMain}
              onClick={() => router.push(row.href)}
              aria-label={`Open ${row.title}`}
            >
              <span className={styles.iconWrap} aria-hidden="true">{row.icon}</span>
              <span className={styles.count}>{row.count}</span>
              <span className={styles.textCol}>
                <span className={styles.rowTitle}>{row.title}</span>
                <span className={styles.rowSubtitle}>{row.subtitle}</span>
              </span>
            </button>
            <button
              type="button"
              className={styles.notedBtn}
              onClick={() => noteOne(row.kind)}
            >
              Noted
            </button>
          </li>
        ))}
      </ul>

      <p className={styles.footer}>Stay on top of important updates.</p>
    </section>
  );
}
