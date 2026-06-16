"use client";

import { useRouter } from "next/navigation";
import styles from "./page.module.css";

/* ──────────────────────────────────────────────────────────────────────
 * Placeholder data — will be wired up to staff_onboarding queries
 * (holidayRequests / availabilityRequests / completedStep / visa expiry)
 * in a follow-up. Shape mirrors what the real Firestore reads will look
 * like so the swap is straightforward.
 * ──────────────────────────────────────────────────────────────────── */

type ReqStatus = "pending";

type HolidayItem = {
  kind: "holiday";
  id: string;
  firstName: string;
  lastName: string;
  startISO: string;
  endISO: string;
  note?: string;
  agoText: string;
  status: ReqStatus;
};

type AvailabilityItem = {
  kind: "availability";
  id: string;
  firstName: string;
  lastName: string;
  effectiveISO: string;
  note?: string;
  agoText: string;
  status: ReqStatus;
};

type OnboardingItem = {
  kind: "onboarding";
  id: string;
  firstName: string;
  lastName: string;
  startDateISO: string;
  state: "Submitted" | "In Progress";
  agoText: string;
};

type ComplianceItem = {
  kind: "compliance";
  id: string;
  firstName: string;
  lastName: string;
  reason: string; // e.g. "Visa Expiring Soon"
  expiresISO: string;
  note?: string;
  agoText: string;
};

const REQUESTS: (HolidayItem | AvailabilityItem)[] = [
  {
    kind: "holiday",
    id: "h-1",
    firstName: "Yuki",
    lastName: "Tanaka",
    startISO: "2026-06-18",
    endISO: "2026-06-22",
    note: "Family trip to Osaka.",
    agoText: "2 days ago",
    status: "pending",
  },
  {
    kind: "availability",
    id: "a-1",
    firstName: "Sam",
    lastName: "Lee",
    effectiveISO: "2026-07-01",
    note: "Changing availability to Tuesday off.",
    agoText: "1 day ago",
    status: "pending",
  },
  {
    kind: "holiday",
    id: "h-2",
    firstName: "Hiyori",
    lastName: "Sato",
    startISO: "2026-07-05",
    endISO: "2026-07-07",
    note: "Visiting family.",
    agoText: "3 days ago",
    status: "pending",
  },
];

const ONBOARDING: OnboardingItem[] = [
  {
    kind: "onboarding",
    id: "o-1",
    firstName: "Kenji",
    lastName: "Watanabe",
    startDateISO: "2026-06-15",
    state: "Submitted",
    agoText: "4 days ago",
  },
];

const COMPLIANCE: ComplianceItem[] = [
  {
    kind: "compliance",
    id: "c-1",
    firstName: "Mei",
    lastName: "Chen",
    reason: "Visa Expiring Soon",
    expiresISO: "2026-07-10",
    note: "Working Holiday Visa (subclass 417)",
    agoText: "5 days ago",
  },
];

function initials(first: string, last: string): string {
  return (first.charAt(0) + last.charAt(0)).toUpperCase();
}

function fmtShort(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtRangeShort(startISO: string, endISO: string): string {
  const [sy, sm, sd] = startISO.split("-").map(Number);
  const [ey, em, ed] = endISO.split("-").map(Number);
  const sameYear = sy === ey;
  const sameMonth = sameYear && sm === em;
  const right = new Date(ey, em - 1, ed).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  if (sameMonth) {
    return `${sd} – ${right}`;
  }
  const left = new Date(sy, sm - 1, sd).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
  });
  return `${left} – ${right}`;
}

function daysInclusive(startISO: string, endISO: string): number {
  const a = new Date(startISO);
  const b = new Date(endISO);
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}

export default function AttentionRequiredPage() {
  const router = useRouter();
  const total = REQUESTS.length + ONBOARDING.length + COMPLIANCE.length;

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
          <span className={styles.sectionCount}>{REQUESTS.length}</span>
        </div>

        <ul className={styles.list}>
          {REQUESTS.map((r) => (
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
                      ? `${fmtRangeShort(r.startISO, r.endISO)} (${daysInclusive(r.startISO, r.endISO)} days)`
                      : `Effective from ${fmtShort(r.effectiveISO)}`}
                  </p>
                </div>
                <span className={styles.ago}>{r.agoText}</span>
              </div>
              {r.note && (
                <p className={styles.note}>
                  <span className={styles.noteLabel}>Note:</span> {r.note}
                </p>
              )}
              <div className={styles.actionRow}>
                <button type="button" className={styles.btnDecline}>Decline</button>
                <button type="button" className={styles.btnApprove}>Approve</button>
              </div>
            </li>
          ))}
        </ul>
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
          <span className={styles.sectionCount}>{ONBOARDING.length}</span>
        </div>

        <ul className={styles.list}>
          {ONBOARDING.map((o) => (
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
                    Start date: {fmtShort(o.startDateISO)}
                  </p>
                </div>
                <span className={styles.ago}>{o.agoText}</span>
              </div>
              <p className={styles.statusLine}>
                <span className={styles.noteLabel}>Status:</span>{" "}
                <span className={styles.statusPill}>{o.state}</span>
              </p>
            </li>
          ))}
        </ul>
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
          <span className={styles.sectionCount}>{COMPLIANCE.length}</span>
        </div>

        <ul className={styles.list}>
          {COMPLIANCE.map((c) => (
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
                    Expires: {fmtShort(c.expiresISO)}
                  </p>
                </div>
                <span className={styles.ago}>{c.agoText}</span>
              </div>
              {c.note && (
                <p className={styles.note}>
                  <span className={styles.noteLabel}>Note:</span> {c.note}
                </p>
              )}
              <div className={styles.actionRow}>
                <button type="button" className={styles.btnGhost}>Send Reminder</button>
              </div>
            </li>
          ))}
        </ul>
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
