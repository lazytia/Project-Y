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
  serverTimestamp,
  setDoc,
  type Timestamp,
} from "firebase/firestore";
import type { User } from "firebase/auth";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { canViewStaffRequest } from "@/lib/permissions";
import { isOnboardingListEmployee, staffOnboardingFlags } from "@/lib/staff-active";
import { runWhenIdle } from "@/lib/run-when-idle";
import { isNoticeGivenActive, isReadyToTerminate, noticeLastWorkingDay } from "@/lib/notice-last-day";
import styles from "./DashboardAttention.module.css";

/**
 * Owner Dashboard — top-of-screen attention card. Surfaces today's new
 * items (catering, sold-out, HR notes, cash) and ongoing items (onboarding,
 * notice given, ready to terminate).
 *
 * "Noted" is permanent: a dismissed row never comes back on its own, and
 * only reappears once the count climbs past what was dismissed — i.e. when
 * something genuinely new has arrived.
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

type NotedEntry = { date: string; count: number };
type NotedMap = Partial<Record<AttentionKind, NotedEntry>>;

/* ── date helpers ── */

function sydneyTodayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: SYDNEY_TZ });
}

function startOfSydneyToday(): Date {
  const key = sydneyTodayKey();
  const [y, m, d] = key.split("-").map(Number);
  // Return the actual UTC instant of 00:00 Sydney on the given date.
  // Sydney is UTC+10 (AEST) or UTC+11 (AEDT) — figure out which is in
  // effect on this date by asking what hour noon-UTC lands on in
  // Sydney: +10 → "22", +11 → "23".
  const sampleUtc = new Date(Date.UTC(y, m - 1, d, 12));
  const sydHour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: SYDNEY_TZ,
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(sampleUtc)
      .find((p) => p.type === "hour")?.value ?? "22",
  );
  const offsetHours = sydHour - 12; // 10 or 11
  return new Date(Date.UTC(y, m - 1, d) - offsetHours * 60 * 60 * 1000);
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

function normalizeNotedEntry(raw: unknown): NotedEntry | null {
  if (typeof raw === "string") {
    // Legacy: date-only — treat as noted through that day for daily items;
    // persistent items use a high count so they stay dismissed until activity grows.
    return { date: raw, count: Number.MAX_SAFE_INTEGER };
  }
  if (raw && typeof raw === "object") {
    const o = raw as { date?: unknown; count?: unknown };
    if (typeof o.date === "string" && typeof o.count === "number" && Number.isFinite(o.count)) {
      return { date: o.date, count: o.count };
    }
  }
  return null;
}

function normalizeNotedMap(raw: unknown): NotedMap {
  if (!raw || typeof raw !== "object") return {};
  const out: NotedMap = {};
  for (const [k, v] of Object.entries(raw)) {
    const entry = normalizeNotedEntry(v);
    if (entry) out[k as AttentionKind] = entry;
  }
  return out;
}

function mergeNotedEntry(
  a: NotedEntry | undefined,
  b: NotedEntry | undefined,
): NotedEntry | undefined {
  if (!a) return b;
  if (!b) return a;
  // `date` is when the mark was last written, so the newer write is the more
  // recent observation of the backlog — including one that revised the count
  // downwards.
  return a.date >= b.date ? a : b;
}

function mergeNotedMaps(a: NotedMap, b: NotedMap): NotedMap {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: NotedMap = {};
  for (const key of keys) {
    const kind = key as AttentionKind;
    const merged = mergeNotedEntry(a[kind], b[kind]);
    if (merged) out[kind] = merged;
  }
  return out;
}

function isRowNoted(kind: AttentionKind, count: number, noted: NotedMap): boolean {
  const entry = noted[kind];
  return entry ? count <= entry.count : false;
}

function notedStorageKey(uid: string): string {
  return `${STORAGE_KEY}.${uid}`;
}

function readNoted(uid: string): NotedMap {
  if (typeof window === "undefined" || !uid) return {};
  try {
    const keyed = window.localStorage.getItem(notedStorageKey(uid));
    if (keyed) return normalizeNotedMap(JSON.parse(keyed));
    // One-time migration from the pre-uid local key.
    const legacy = window.localStorage.getItem(STORAGE_KEY);
    return legacy ? normalizeNotedMap(JSON.parse(legacy)) : {};
  } catch {
    return {};
  }
}

function writeNoted(uid: string, next: NotedMap) {
  if (!uid) return;
  try {
    window.localStorage.setItem(notedStorageKey(uid), JSON.stringify(next));
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

async function loadNewEmployeeCount(viewer: User | null): Promise<number> {
  // Count the rows /people/onboarding would actually list, by calling that
  // page's own predicates rather than a second rule that merely resembles
  // them. The old rule skipped `role === "owner"` and then counted anyone
  // unapproved who had reached step 7 — which caught the chef, whose doc is
  // stamped completedStep 7 / status "complete" on every sign-in and is
  // never "approved" because he was never a new-hire request. So the card
  // advertised a request that the list, quite correctly, refused to show.
  //
  // Visibility is part of the count for the same reason: a manager only sees
  // manager-submitted requests, so counting one they cannot open would put
  // back the same dead end in a different place.
  const snap = await getDocs(collection(getDb(), "staff_onboarding"));
  return snap.docs.reduce((acc, d) => {
    const raw = d.data() as Record<string, unknown>;
    const listed = isOnboardingListEmployee(staffOnboardingFlags(raw));
    if (!listed) return acc;
    const visible = canViewStaffRequest(viewer, {
      requestedByRole: raw.requestedByRole as string | undefined,
      requestedByName: raw.requestedByName as string | undefined,
    });
    return visible ? acc + 1 : acc;
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
  const { user } = useAuth();
  const [counts, setCounts] = useState<Partial<Record<AttentionKind, number>> | null>(null);
  const [noted, setNoted] = useState<NotedMap>({});
  const [todayKey, setTodayKey] = useState(() => sydneyTodayKey());
  const [fetchEnabled, setFetchEnabled] = useState(false);

  useEffect(() => {
    if (!user) {
      setNoted({});
      return;
    }
    setNoted(readNoted(user.uid));
  }, [user]);

  // Hydrate noted map from Firestore so "Noted" persists across devices /
  // browsers / PWA reinstalls — localStorage alone left the owner seeing
  // the same items re-appear whenever they opened the dashboard from a
  // different device.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(getDb(), "dashboard_attention_noted", user.uid));
        if (cancelled) return;
        const remote = normalizeNotedMap(snap.exists() ? snap.data()?.noted : undefined);
        const merged = mergeNotedMaps(readNoted(user.uid), remote);
        setNoted(merged);
        writeNoted(user.uid, merged);
        if (JSON.stringify(merged) !== JSON.stringify(remote)) {
          setDoc(
            doc(getDb(), "dashboard_attention_noted", user.uid),
            { noted: merged, updatedAt: serverTimestamp() },
            { merge: true },
          ).catch(() => {/* best-effort */});
        }
      } catch {
        /* offline — fall back to localStorage */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    return runWhenIdle(() => setFetchEnabled(true), 2500);
  }, []);

  useEffect(() => {
    if (!todayKey || !fetchEnabled) return;
    let cancelled = false;
    (async () => {
      const sinceUtc = startOfSydneyToday();
      const [catering, soldOut, newEmp, notice, ready, hr, cash] = await Promise.all([
        loadCateringCount(sinceUtc, todayKey).catch(() => 0),
        loadSoldOutCount(todayKey).catch(() => 0),
        loadNewEmployeeCount(user).catch(() => 0),
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
    // `user` is a dependency because the new-employee count is scoped to who
    // is looking — a manager sees only manager-submitted requests.
  }, [todayKey, fetchEnabled, user]);

  // A dismissal is a high-water mark, and today-scoped counts drop back to
  // zero overnight. Without following them down, a mark set at yesterday's
  // count would swallow the next genuinely new item instead of surfacing it.
  useEffect(() => {
    if (!user || !counts) return;
    const day = todayKey || sydneyTodayKey();
    const next: NotedMap = { ...noted };
    let changed = false;
    for (const [key, entry] of Object.entries(next) as [AttentionKind, NotedEntry][]) {
      const live = counts[key] ?? 0;
      if (live < entry.count) {
        next[key] = { date: day, count: live };
        changed = true;
      }
    }
    if (!changed) return;
    setNoted(next);
    writeNoted(user.uid, next);
    setDoc(
      doc(getDb(), "dashboard_attention_noted", user.uid),
      { noted: next, updatedAt: serverTimestamp() },
      { merge: true },
    ).catch(() => {/* best-effort */});
  }, [counts, noted, todayKey, user]);

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
    return build.filter((r) => r.count > 0 && !isRowNoted(r.kind, r.count, noted));
  }, [counts, noted]);

  if (!counts || rows.length === 0) return null;

  function persistRemote(next: NotedMap) {
    if (!user) return;
    setDoc(
      doc(getDb(), "dashboard_attention_noted", user.uid),
      { noted: next, updatedAt: serverTimestamp() },
      { merge: true },
    ).catch(() => {/* best-effort */});
  }

  function noteOne(kind: AttentionKind, count: number) {
    if (!user) return;
    const day = todayKey || sydneyTodayKey();
    const next: NotedMap = { ...noted, [kind]: { date: day, count } };
    setNoted(next);
    writeNoted(user.uid, next);
    persistRemote(next);
  }

  function noteAll() {
    if (!user) return;
    const day = todayKey || sydneyTodayKey();
    const next: NotedMap = { ...noted };
    for (const r of rows) next[r.kind] = { date: day, count: r.count };
    setNoted(next);
    writeNoted(user.uid, next);
    persistRemote(next);
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
              onClick={() => noteOne(row.kind, row.count)}
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
