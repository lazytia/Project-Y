"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, getDocs, type Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import {
  decideHolidayRequest,
  decideAvailabilityRequest,
  type Decision,
} from "@/lib/manager-actions";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

type DayAvailability =
  | { kind: "available" }
  | { kind: "unavailable" }
  | { kind: "partial"; from: string; until: string };

type StoredHolidayRequest = {
  id: string;
  startDate: Timestamp;
  endDate: Timestamp;
  reason: string;
  status: "pending" | "approved" | "declined";
  createdAt?: Timestamp;
};

type StoredAvailabilityRequest = {
  id: string;
  requested: Record<string, DayAvailability>;
  reason: string | null;
  effectiveDate?: Timestamp;
  status: "pending" | "approved" | "declined";
  createdAt?: Timestamp;
};

type StaffDoc = {
  uid: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  role?: string;
  status?: string;
  completedStep?: number;
  startDate?: Timestamp;
  documents?: { visaExpiry?: Timestamp };
  holidayRequests?: StoredHolidayRequest[];
  availabilityRequests?: StoredAvailabilityRequest[];
};

type ReqItemHoliday = {
  kind: "holiday";
  id: string;
  staffUid: string;
  firstName: string;
  lastName: string;
  startDate: Date;
  endDate: Date;
  reason: string;
  createdAt: Date | null;
};

type ReqItemAvail = {
  kind: "availability";
  id: string;
  staffUid: string;
  firstName: string;
  lastName: string;
  effectiveDate: Date | null;
  reason: string;
  requested: Record<string, DayAvailability>;
  createdAt: Date | null;
};

type OnboardingItem = {
  id: string;
  staffUid: string;
  firstName: string;
  lastName: string;
  startDate: Date | null;
  state: "Submitted" | "In Progress";
  createdAt: Date | null;
};

type ComplianceItem = {
  id: string;
  staffUid: string;
  firstName: string;
  lastName: string;
  reason: string;
  expiresAt: Date;
  createdAt: Date | null;
};

function tsDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object" && v !== null && "toDate" in (v as object)) {
    try { return (v as Timestamp).toDate(); } catch { return null; }
  }
  return null;
}

function nameOf(d: StaffDoc): { firstName: string; lastName: string } {
  const first = (d.firstName ?? "").trim();
  const last = (d.lastName ?? "").trim();
  if (first || last) return { firstName: first || "—", lastName: last };
  // Fall back to capitalised username when name fields aren't filled yet.
  const u = (d.username ?? "").trim();
  if (u) {
    return { firstName: u.charAt(0).toUpperCase() + u.slice(1), lastName: "" };
  }
  return { firstName: d.uid.slice(0, 6), lastName: "" };
}

function initials(first: string, last: string): string {
  const a = (first.charAt(0) || "?").toUpperCase();
  const b = (last.charAt(0) || "").toUpperCase();
  return (a + b) || "??";
}

function fmtShort(d: Date): string {
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtRangeShort(a: Date, b: Date): string {
  const sameYear = a.getFullYear() === b.getFullYear();
  const sameMonth = sameYear && a.getMonth() === b.getMonth();
  const right = fmtShort(b);
  if (sameMonth) return `${a.getDate()} – ${right}`;
  const left = a.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
  });
  return `${left} – ${right}`;
}

function daysInclusive(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}

function fmtRelative(d: Date | null): string {
  if (!d) return "";
  const diff = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const days = Math.floor(diff / 86400);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function fmtTime12h(t: string): string {
  if (!/^\d{1,2}:\d{2}$/.test(t)) return t;
  const [hStr, mStr] = t.split(":");
  let h = parseInt(hStr, 10);
  const period = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${mStr} ${period}`;
}

function availabilityLabel(a: DayAvailability): string {
  if (a.kind === "available") return "Available";
  if (a.kind === "unavailable") return "Unavailable";
  return `${fmtTime12h(a.from)} – ${fmtTime12h(a.until)}`;
}

function availabilityKey(a: DayAvailability): string {
  if (a.kind === "available") return "available";
  if (a.kind === "unavailable") return "unavailable";
  return `partial:${a.from}-${a.until}`;
}

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_SHORT: Record<typeof DAY_KEYS[number], string> = {
  mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu",
  fri: "Fri", sat: "Sat", sun: "Sun",
};

/**
 * Compress a Mon→Sun availability dict into the smallest list of ranges
 * the manager has to read. Adjacent days with the same value collapse into
 * "Mon–Fri", isolated days stay as "Wed". Default to "Available" for any
 * unset weekday so the manager sees the full week's intent.
 */
function groupAvailability(
  requested: Record<string, DayAvailability>,
): { range: string; value: DayAvailability }[] {
  const filled: DayAvailability[] = DAY_KEYS.map(
    (k) => requested[k] ?? { kind: "available" as const },
  );
  const out: { range: string; value: DayAvailability }[] = [];
  let i = 0;
  while (i < filled.length) {
    const key = availabilityKey(filled[i]);
    let j = i;
    while (j + 1 < filled.length && availabilityKey(filled[j + 1]) === key) {
      j += 1;
    }
    const startShort = DAY_SHORT[DAY_KEYS[i]];
    const endShort = DAY_SHORT[DAY_KEYS[j]];
    const range = i === j ? startShort : `${startShort}–${endShort}`;
    out.push({ range, value: filled[i] });
    i = j + 1;
  }
  return out;
}

const VISA_EXPIRING_WINDOW_DAYS = 60;

function isVisaExpiringSoon(exp: Date | null): boolean {
  if (!exp) return false;
  const diff = (exp.getTime() - Date.now()) / 86400000;
  return diff <= VISA_EXPIRING_WINDOW_DAYS && diff >= -3;
}

export default function AttentionRequiredPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [staffDocs, setStaffDocs] = useState<StaffDoc[]>([]);
  const [busy, setBusy] = useState<string | null>(null); // request id being decided

  const load = useCallback(async () => {
    const snap = await getDocs(collection(getDb(), "staff_onboarding"));
    const docs: StaffDoc[] = snap.docs
      .map((d) => ({ uid: d.id, ...(d.data() as Omit<StaffDoc, "uid">) }))
      .filter((d) => d.role !== "owner");
    setStaffDocs(docs);
  }, []);

  useEffect(() => {
    (async () => {
      try { await load(); } finally { setLoading(false); }
    })();
  }, [load]);

  const { requests, onboarding, compliance } = useMemo(() => {
    const requests: (ReqItemHoliday | ReqItemAvail)[] = [];
    const onboarding: OnboardingItem[] = [];
    const compliance: ComplianceItem[] = [];

    for (const d of staffDocs) {
      const { firstName, lastName } = nameOf(d);

      for (const r of d.holidayRequests ?? []) {
        if (r.status !== "pending") continue;
        const start = tsDate(r.startDate);
        const end = tsDate(r.endDate);
        if (!start || !end) continue;
        requests.push({
          kind: "holiday",
          id: r.id,
          staffUid: d.uid,
          firstName, lastName,
          startDate: start,
          endDate: end,
          reason: r.reason ?? "",
          createdAt: tsDate(r.createdAt),
        });
      }
      for (const r of d.availabilityRequests ?? []) {
        if (r.status !== "pending") continue;
        requests.push({
          kind: "availability",
          id: r.id,
          staffUid: d.uid,
          firstName, lastName,
          effectiveDate: tsDate(r.effectiveDate),
          reason: r.reason ?? "",
          requested: (r.requested ?? {}) as Record<string, DayAvailability>,
          createdAt: tsDate(r.createdAt),
        });
      }

      // Onboarding: staff who have submitted (completedStep >= 7) but
      // status hasn't been moved past "complete" yet, or who are still in
      // progress. We surface "Submitted" specifically.
      const completed = typeof d.completedStep === "number" ? d.completedStep : 0;
      if (completed >= 7 && d.status === "complete") {
        onboarding.push({
          id: `ob_${d.uid}`,
          staffUid: d.uid,
          firstName, lastName,
          startDate: tsDate(d.startDate),
          state: "Submitted",
          createdAt: tsDate(d.startDate),
        });
      }

      // Compliance: visa expiring within the window.
      const visaExp = tsDate(d.documents?.visaExpiry);
      if (visaExp && isVisaExpiringSoon(visaExp)) {
        compliance.push({
          id: `cm_${d.uid}`,
          staffUid: d.uid,
          firstName, lastName,
          reason: "Visa Expiring Soon",
          expiresAt: visaExp,
          createdAt: null,
        });
      }
    }

    // Newest first.
    requests.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
    onboarding.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));

    return { requests, onboarding, compliance };
  }, [staffDocs]);

  const total = requests.length + onboarding.length + compliance.length;

  async function decide(
    kind: "holiday" | "availability",
    staffUid: string,
    requestId: string,
    decision: Decision,
  ) {
    if (!user) return;
    setBusy(requestId);
    try {
      if (kind === "holiday") {
        await decideHolidayRequest(staffUid, user.uid, requestId, decision);
      } else {
        await decideAvailabilityRequest(staffUid, user.uid, requestId, decision);
      }
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed.");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <Splash />;

  return (
    <div className={styles.page}>
      <button
        type="button"
        className={styles.backBtn}
        onClick={() => router.push("/")}
        aria-label="Back"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      <header className={styles.heading}>
        <h1 className={styles.title}>
          Attention Required <span className={styles.totalBadge}>{total}</span>
        </h1>
        <p className={styles.subtitle}>Review and take action on pending items</p>
      </header>

      {/* REQUESTS */}
      <section>
        <div className={styles.sectionHead}>
          <span className={styles.sectionIcon} aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </span>
          <p className={styles.sectionLabel}>REQUESTS</p>
          <span className={styles.sectionCount}>{requests.length}</span>
          <span className={styles.viewAll}>View all</span>
        </div>

        {requests.length === 0 ? (
          <p className={styles.empty}>No pending requests.</p>
        ) : (
          <ul className={styles.list}>
            {requests.map((r) => (
              <li key={r.id} className={styles.card}>
                <div className={styles.cardHeader}>
                  <div className={styles.avatar} aria-hidden="true">
                    {initials(r.firstName, r.lastName)}
                  </div>
                  <div className={styles.headBody}>
                    <p className={styles.name}>{r.firstName} {r.lastName}</p>
                    <p className={styles.kind}>
                      {r.kind === "holiday" ? "Holiday Request" : "Availability Change"}
                    </p>
                    <p className={styles.meta}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="4" width="18" height="18" rx="2" />
                        <line x1="16" y1="2" x2="16" y2="6" />
                        <line x1="8" y1="2" x2="8" y2="6" />
                        <line x1="3" y1="10" x2="21" y2="10" />
                      </svg>
                      {r.kind === "holiday"
                        ? `${fmtRangeShort(r.startDate, r.endDate)} (${daysInclusive(r.startDate, r.endDate)} days)`
                        : r.effectiveDate
                          ? `Effective from ${fmtShort(r.effectiveDate)}`
                          : "Effective date not set"}
                    </p>
                  </div>
                  <span className={styles.ago}>{fmtRelative(r.createdAt)}</span>
                </div>
                {r.kind === "availability" && (
                  <div className={styles.availBlock}>
                    <p className={styles.availLabel}>Requested Availability</p>
                    <div className={styles.availTable}>
                      {groupAvailability(r.requested).map((row, idx) => (
                        <div key={idx} className={styles.availRow}>
                          <span className={styles.availRange}>{row.range}</span>
                          <span className={styles.availValue}>
                            {availabilityLabel(row.value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {r.reason && (
                  <p className={styles.note}>
                    <span className={styles.noteLabel}>Note:</span> {r.reason}
                  </p>
                )}
                <div className={styles.actionRow}>
                  <button
                    type="button"
                    className={styles.btnDecline}
                    disabled={busy === r.id}
                    onClick={() => decide(r.kind, r.staffUid, r.id, "declined")}
                  >
                    {busy === r.id ? "…" : "Decline"}
                  </button>
                  <button
                    type="button"
                    className={styles.btnApprove}
                    disabled={busy === r.id}
                    onClick={() => decide(r.kind, r.staffUid, r.id, "approved")}
                  >
                    {busy === r.id ? "…" : "Approve"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ONBOARDING */}
      <section>
        <div className={styles.sectionHead}>
          <span className={styles.sectionIcon} aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <line x1="20" y1="8" x2="20" y2="14" />
              <line x1="23" y1="11" x2="17" y2="11" />
            </svg>
          </span>
          <p className={styles.sectionLabel}>ONBOARDING</p>
          <span className={styles.sectionCount}>{onboarding.length}</span>
          <span className={styles.viewAll}>View all</span>
        </div>

        {onboarding.length === 0 ? (
          <p className={styles.empty}>No onboarding submissions waiting.</p>
        ) : (
          <ul className={styles.list}>
            {onboarding.map((o) => (
              <li key={o.id} className={styles.card}>
                <div className={styles.cardHeader}>
                  <div className={styles.avatar} aria-hidden="true">
                    {initials(o.firstName, o.lastName)}
                  </div>
                  <div className={styles.headBody}>
                    <p className={styles.name}>{o.firstName} {o.lastName}</p>
                    <p className={styles.kind}>New Onboarding</p>
                    <p className={styles.meta}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="4" width="18" height="18" rx="2" />
                        <line x1="16" y1="2" x2="16" y2="6" />
                        <line x1="8" y1="2" x2="8" y2="6" />
                        <line x1="3" y1="10" x2="21" y2="10" />
                      </svg>
                      Start date: {o.startDate ? fmtShort(o.startDate) : "—"}
                    </p>
                  </div>
                  <span className={styles.ago}>{fmtRelative(o.createdAt)}</span>
                </div>
                <p className={styles.statusLine}>
                  <span className={styles.noteLabel}>Status:</span>{" "}
                  <span className={styles.statusPill}>{o.state}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* COMPLIANCE */}
      <section>
        <div className={styles.sectionHead}>
          <span className={styles.sectionIcon} aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <circle cx="9" cy="11" r="2.2" />
              <path d="M5.5 17c0-1.6 1.6-2.7 3.5-2.7s3.5 1.1 3.5 2.7" />
              <line x1="14" y1="9" x2="18" y2="9" />
              <line x1="14" y1="13" x2="18" y2="13" />
            </svg>
          </span>
          <p className={styles.sectionLabel}>COMPLIANCE</p>
          <span className={styles.sectionCount}>{compliance.length}</span>
          <span className={styles.viewAll}>View all</span>
        </div>

        {compliance.length === 0 ? (
          <p className={styles.empty}>No compliance items.</p>
        ) : (
          <ul className={styles.list}>
            {compliance.map((c) => (
              <li key={c.id} className={styles.card}>
                <div className={styles.cardHeader}>
                  <div className={styles.avatar} aria-hidden="true">
                    {initials(c.firstName, c.lastName)}
                  </div>
                  <div className={styles.headBody}>
                    <p className={styles.name}>{c.firstName} {c.lastName}</p>
                    <p className={styles.kind}>{c.reason}</p>
                    <p className={styles.meta}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="4" width="18" height="18" rx="2" />
                        <line x1="16" y1="2" x2="16" y2="6" />
                        <line x1="8" y1="2" x2="8" y2="6" />
                        <line x1="3" y1="10" x2="21" y2="10" />
                      </svg>
                      Expires: {fmtShort(c.expiresAt)}
                    </p>
                  </div>
                </div>
                <div className={styles.actionRow}>
                  <button type="button" className={styles.btnGhost}>Send Reminder</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className={styles.footerNote}>
        <span className={styles.footerIcon} aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </span>
        <div className={styles.footerBody}>
          <p className={styles.footerTitle}>Please review and take action</p>
          <p className={styles.footerSub}>
            Keeping these items up to date helps us run a smooth operation.
          </p>
        </div>
      </div>
    </div>
  );
}
