"use client";

import { use, useEffect, useState } from "react";
import { useRouter, notFound } from "next/navigation";
import { doc, getDoc, type Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

/* ──────────────────────────────────────────────────────────────────────
 * Staff notification detail page — renders the full record for an
 * approved / declined Holiday or Availability change decision.
 * ──────────────────────────────────────────────────────────────────── */

type Status = "approved" | "declined";

type StoredNotification = {
  id: string;
  kind?: string;
  title?: string;
  detail?: string;
  createdAt?: Timestamp;
  requestType?: "holiday" | "availability";
  requestId?: string;
  // Holiday fields stored inline for reliability (fallback if request lookup fails)
  startDate?: Timestamp;
  endDate?: Timestamp;
  // Availability fields stored inline for reliability
  effectiveDate?: Timestamp;
  requested?: Record<string, DayAvailability>;
  previousAvailability?: Record<string, DayAvailability>;
};

type HolidayRequest = {
  id: string;
  startDate?: Timestamp;
  endDate?: Timestamp;
  reason?: string;
  status?: "pending" | "approved" | "declined";
  createdAt?: Timestamp;
  decidedAt?: Timestamp;
  decidedBy?: string;
};

type DayAvailability =
  | { kind: "available" }
  | { kind: "unavailable" }
  | { kind: "partial"; from: string; until: string };

type AvailabilityRequest = {
  id: string;
  effectiveDate?: Timestamp;
  reason?: string | null;
  requested?: Record<string, DayAvailability>;
  previousAvailability?: Record<string, DayAvailability>;
  status?: "pending" | "approved" | "declined";
  createdAt?: Timestamp;
  decidedAt?: Timestamp;
  decidedBy?: string;
};

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_FULL: Record<typeof DAY_KEYS[number], string> = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday",
  fri: "Friday", sat: "Saturday", sun: "Sunday",
};

function tsDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object" && v !== null) {
    if (typeof (v as { toDate?: unknown }).toDate === "function") {
      try { return (v as Timestamp).toDate(); } catch { return null; }
    }
    // plain {seconds, nanoseconds} — Firestore Timestamp serialised to JSON
    const o = v as { seconds?: unknown; nanoseconds?: unknown };
    if (typeof o.seconds === "number") return new Date(o.seconds * 1000);
  }
  return null;
}

function fmtLongDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtPlainDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtDateTime(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
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

function availabilityLabel(a: DayAvailability | undefined): {
  primary: string;
  secondary?: string;
} {
  if (!a) return { primary: "—" };
  if (a.kind === "available") return { primary: "Available" };
  if (a.kind === "unavailable") return { primary: "Unavailable" };
  return {
    primary: "Partial",
    secondary: `${fmtTime12h(a.from)} – ${fmtTime12h(a.until)}`,
  };
}

function eachDay(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  const stop = new Date(end);
  stop.setHours(0, 0, 0, 0);
  while (cur.getTime() <= stop.getTime()) {
    out.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function findChangedDay(
  requested: Record<string, DayAvailability> | undefined,
  previous: Record<string, DayAvailability> | undefined,
): typeof DAY_KEYS[number] | null {
  if (!requested) return null;
  for (const k of DAY_KEYS) {
    const r = requested[k];
    const p = previous?.[k];
    if (r && JSON.stringify(r) !== JSON.stringify(p)) return k;
  }
  // Fall back: first non-null requested day.
  for (const k of DAY_KEYS) {
    if (requested[k]) return k;
  }
  return null;
}

function changeType(
  prev: DayAvailability | undefined,
  next: DayAvailability | undefined,
): string {
  if (!prev || !next) return "Change";
  if (prev.kind === next.kind) {
    if (prev.kind === "partial" && next.kind === "partial") {
      if (prev.from !== next.from || prev.until !== next.until) return "Time Change";
    }
    return "Change";
  }
  if (next.kind === "available") return "Now Available";
  if (next.kind === "unavailable") return "Now Unavailable";
  return "Time Change";
}

export default function NotificationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { id } = use(params);
  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState<StoredNotification | null>(null);
  const [holiday, setHoliday] = useState<HolidayRequest | null>(null);
  const [availability, setAvailability] = useState<AvailabilityRequest | null>(null);

  useEffect(() => {
    if (authLoading || !user) return;
    (async () => {
      try {
        const snap = await getDoc(doc(getDb(), "staff_onboarding", user.uid));
        const data = snap.data() ?? {};

        const arr = (data.notifications ?? []) as StoredNotification[];
        const n = arr.find((x) => x.id === id) ?? null;
        setNotification(n);

        const kind = n?.kind ?? "";
        const isHol = kind.startsWith("holiday");
        const isAv = kind.startsWith("availability");
        const notifMs = tsDate(n?.createdAt)?.getTime() ?? 0;

        if (isHol) {
          const list = (data.holidayRequests ?? []) as HolidayRequest[];
          // Primary: match by requestId; fallback: match by decidedAt ≈ notification.createdAt
          const found =
            (n?.requestId ? list.find((r) => r.id === n.requestId) : null) ??
            (notifMs
              ? list.find((r) => {
                  const dec = tsDate(r.decidedAt)?.getTime();
                  return dec !== undefined && Math.abs(dec - notifMs) < 10_000;
                })
              : null) ??
            null;
          setHoliday(found);
        } else if (isAv) {
          const list = (data.availabilityRequests ?? []) as AvailabilityRequest[];
          const found =
            (n?.requestId ? list.find((r) => r.id === n.requestId) : null) ??
            (notifMs
              ? list.find((r) => {
                  const dec = tsDate(r.decidedAt)?.getTime();
                  return dec !== undefined && Math.abs(dec - notifMs) < 10_000;
                })
              : null) ??
            null;
          setAvailability(found);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [authLoading, user, id]);

  if (authLoading || loading) return <Splash />;
  if (!notification) notFound();

  const kind = notification.kind ?? "";
  const status: Status = kind.endsWith("approved") ? "approved" : "declined";
  const isHoliday = kind.startsWith("holiday");
  const isAvailability = kind.startsWith("availability");

  const decidedAt =
    tsDate(holiday?.decidedAt) ??
    tsDate(availability?.decidedAt) ??
    tsDate(notification.createdAt);

  const titleHeading = isHoliday ? "Holiday Request" : "Availability Change";
  const heroSub = isHoliday
    ? status === "approved"
      ? "Your holiday request has been approved."
      : "Your holiday request was declined."
    : status === "approved"
      ? "Your availability change request has been approved."
      : "Your availability change request was declined.";

  // Holiday-specific
  // Prefer inline fields stored on the notification; fall back to the linked request.
  const holidayDates = (() => {
    if (!isHoliday) return [] as Date[];
    const start = tsDate(notification.startDate) ?? tsDate(holiday?.startDate);
    const end = tsDate(notification.endDate) ?? tsDate(holiday?.endDate);
    if (!start || !end) return [];
    return eachDay(start, end);
  })();

  // Availability-specific
  // Prefer inline fields stored on the notification; fall back to the linked request.
  const effDate =
    tsDate(notification.effectiveDate) ?? tsDate(availability?.effectiveDate);
  const requestedMap =
    availability?.requested ?? notification.requested ?? undefined;
  const previousMap =
    availability?.previousAvailability ??
    notification.previousAvailability ??
    undefined;

  // Collect all requested days so we always have something to show.
  const requestedDays: Array<{ key: string; label: string; prev: DayAvailability | undefined; next: DayAvailability | undefined }> = [];
  if (requestedMap) {
    for (const k of DAY_KEYS) {
      const next = requestedMap[k];
      if (!next) continue;
      const prev = previousMap?.[k];
      // Only include days that actually changed (or all if no prev data)
      const changed = !prev || JSON.stringify(next) !== JSON.stringify(prev);
      if (changed) {
        requestedDays.push({ key: k, label: DAY_FULL[k as typeof DAY_KEYS[number]], prev, next });
      }
    }
    // Fallback: if nothing changed (shouldn't happen), show all
    if (requestedDays.length === 0) {
      for (const k of DAY_KEYS) {
        const next = requestedMap[k];
        if (next) requestedDays.push({ key: k, label: DAY_FULL[k as typeof DAY_KEYS[number]], prev: undefined, next });
      }
    }
  }
  // Fallback: first changed day label (for Date row when effectiveDate missing)
  const dayKey = isAvailability
    ? findChangedDay(requestedMap, previousMap)
    : null;
  const dayLabel = dayKey ? DAY_FULL[dayKey] : null;

  const notes = ((holiday?.reason ?? availability?.reason) || "").trim();

  return (
    <div className={styles.page}>
      <button
        type="button"
        className={styles.backBtn}
        onClick={() => router.push("/staff")}
        aria-label="Back"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12" />
          <polyline points="12 19 5 12 12 5" />
        </svg>
      </button>

      {/* Hero */}
      <header className={styles.hero}>
        <span className={styles.heroIcon} aria-hidden="true">
          {isAvailability ? (
            // Pencil with status badge
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          ) : (
            // Briefcase / calendar
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="7" width="18" height="13" rx="2" />
              <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          )}
          <span
            className={`${styles.heroBadge} ${status === "approved" ? styles.heroBadgeOk : styles.heroBadgeNo}`}
            aria-hidden="true"
          >
            {status === "approved" ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            )}
          </span>
        </span>
        <div className={styles.heroBody}>
          <p className={`${styles.heroPill} ${status === "approved" ? styles.heroPillOk : styles.heroPillNo}`}>
            <span className={styles.heroPillDot} aria-hidden="true" />
            {status === "approved" ? "Approved" : "Declined"}
          </p>
          <h1 className={styles.heroTitle}>{titleHeading}</h1>
          <p className={styles.heroSub}>{heroSub}</p>
        </div>
      </header>

      {/* Detail card */}
      <section className={styles.card}>
        <Row
          icon={<CalIcon />}
          label={status === "approved" ? "Approved on" : "Declined on"}
          value={fmtDateTime(decidedAt)}
        />
        <Divider />

        {isHoliday && (
          <>
            <div className={styles.row}>
              <span className={styles.rowIcon}><CaseIcon /></span>
              <div className={styles.rowBody}>
                <p className={styles.rowLabel}>Requested Dates</p>
                {holidayDates.length === 0 ? (
                  <p className={styles.rowValue}>—</p>
                ) : (
                  <ul className={styles.dateList}>
                    {holidayDates.map((d, i) => (
                      <li key={i} className={styles.dateRow}>
                        <span className={styles.dateValue}>
                          {d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
                        </span>
                        <span className={styles.dateDow}>
                          ({d.toLocaleDateString("en-AU", { weekday: "short" })})
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <Divider />
          </>
        )}

        {isAvailability && (
          <>
            <Row
              icon={<CalIcon />}
              label="Effective Date"
              value={effDate ? fmtLongDate(effDate) : dayLabel ?? "—"}
            />
            <Divider />
            {requestedDays.length > 0 ? (
              requestedDays.map(({ key, label, prev, next }) => {
                const prevLabel = availabilityLabel(prev);
                const nextLabel = availabilityLabel(next);
                return (
                  <div key={key}>
                    <div className={styles.row}>
                      <span className={styles.rowIcon}><ClockIcon /></span>
                      <div className={styles.rowBody}>
                        <p className={styles.rowLabel}>{label}</p>
                        {prev ? (
                          <p className={styles.rowValue}>
                            <span className={styles.strikethrough}>{prevLabel.primary}</span>
                            {" → "}
                            <span className={`${styles.rowValueWarm}`}>{nextLabel.primary}</span>
                            {nextLabel.secondary && (
                              <span className={styles.rowSub}> ({nextLabel.secondary})</span>
                            )}
                          </p>
                        ) : (
                          <p className={`${styles.rowValue} ${styles.rowValueWarm}`}>
                            {nextLabel.primary}
                            {nextLabel.secondary && (
                              <span className={styles.rowSub}> ({nextLabel.secondary})</span>
                            )}
                          </p>
                        )}
                      </div>
                    </div>
                    <Divider />
                  </div>
                );
              })
            ) : (
              <>
                <Row icon={<ClockIcon />} label="Availability Change" value="—" />
                <Divider />
              </>
            )}
          </>
        )}

        <Row
          icon={<PersonIcon />}
          label={status === "approved" ? "Approved by" : "Decided by"}
          value="YURICA Management"
        />
        <Divider />

        <Row
          icon={<NoteIcon />}
          label="Notes"
          value={notes || "-"}
        />
      </section>

      {/* What happens next */}
      <section className={styles.nextCard}>
        <span className={styles.nextIcon} aria-hidden="true">
          <CalIcon />
        </span>
        <div className={styles.nextBody}>
          <p className={styles.nextTitle}>What happens next?</p>
          <p className={styles.nextSub}>
            {status !== "approved"
              ? "Speak to your manager if you have questions about this decision."
              : isHoliday
                ? "Your leave has been added to the roster. You can view your upcoming shifts in the roster section."
                : "Your availability has been updated. This will be reflected in the roster."}
          </p>
        </div>
      </section>

      <button
        type="button"
        className={styles.doneBtn}
        onClick={() => router.push("/staff")}
      >
        Done
      </button>
    </div>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className={styles.row}>
      <span className={styles.rowIcon}>{icon}</span>
      <div className={styles.rowBody}>
        <p className={styles.rowLabel}>{label}</p>
        <p className={styles.rowValue}>{value}</p>
      </div>
    </div>
  );
}

function Divider() {
  return <div className={styles.divider} />;
}

/* ── icons ── */

function CalIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}
function CaseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
function PersonIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
    </svg>
  );
}
function NoteIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}
