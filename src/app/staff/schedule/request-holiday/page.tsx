"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  arrayUnion,
  Timestamp,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import CalendarPicker from "@/components/CalendarPicker";
import styles from "./page.module.css";

type HolidayRequest = {
  id: string;
  startDate: Date;
  endDate: Date;
  reason: string;
  status: "pending" | "approved" | "declined";
  createdAt: Date | null;
};

type StoredHolidayRequest = {
  id: string;
  startDate: Timestamp | Date;
  endDate: Timestamp | Date;
  reason: string;
  status: "pending" | "approved" | "declined";
  createdAt?: Timestamp | Date;
};

const FAR_FUTURE_MAX = "2099-12-31";

function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object" && v !== null && "toDate" in (v as object)) {
    return (v as Timestamp).toDate();
  }
  return null;
}

function todayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
}

function addDays(key: string, days: number): string {
  const d = keyToDate(key);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-CA");
}

function daysFromToday(key: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = keyToDate(key);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function durationDays(startKey: string, endKey: string): number {
  const s = keyToDate(startKey);
  const e = keyToDate(endKey);
  return Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

function keyToDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function fmtKey(key: string | null): string {
  if (!key) return "";
  return keyToDate(key).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtRange(a: Date, b: Date): string {
  const sameYear = a.getFullYear() === b.getFullYear();
  const sameMonth = sameYear && a.getMonth() === b.getMonth();
  const opts = (showYear: boolean): Intl.DateTimeFormatOptions => ({
    day: "numeric",
    month: "short",
    year: showYear ? "numeric" : undefined,
  });
  const left = a.toLocaleDateString("en-AU", opts(!sameYear));
  const right = b.toLocaleDateString("en-AU", opts(true));
  return sameMonth
    ? `${a.getDate()} – ${b.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}`
    : `${left} – ${right}`;
}

function statusClass(status: HolidayRequest["status"]) {
  switch (status) {
    case "approved": return styles.statusApproved;
    case "pending":  return styles.statusPending;
    case "declined": return styles.statusDeclined;
    default:         return styles.statusPending;
  }
}

function statusLabel(status: HolidayRequest["status"]) {
  switch (status) {
    case "approved": return "Approved";
    case "pending":  return "Pending";
    case "declined": return "Declined";
    default:         return "Pending";
  }
}

export default function RequestHolidayPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [startKey, setStartKey] = useState<string>("");
  const [endKey, setEndKey] = useState<string>("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<HolidayRequest[]>([]);
  const [pickerOpen, setPickerOpen] = useState<null | "start" | "end">(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const snap = await getDoc(doc(getDb(), "staff_onboarding", user.uid));
        const data = snap.data() ?? {};
        const arr = (data.holidayRequests ?? []) as StoredHolidayRequest[];
        const parsed: HolidayRequest[] = arr
          .map((r) => {
            const start = toDate(r.startDate);
            const end = toDate(r.endDate);
            if (!start || !end) return null;
            return {
              id: r.id,
              startDate: start,
              endDate: end,
              reason: r.reason ?? "",
              status: r.status ?? "pending",
              createdAt: toDate(r.createdAt),
            } as HolidayRequest;
          })
          .filter((x): x is HolidayRequest => x !== null)
          .sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
        setRequests(parsed);
      } catch {
        /* ignore */
      }
    })();
  }, [user]);

  const todayK = useMemo(todayKey, []);
  // Block the calendar to dates at least 14 days out — staff cannot request
  // holidays inside the 2-week notice window. Longer requests still need
  // the 3-week notice check at submit (noticeRule below).
  const minStartKey = useMemo(() => addDays(todayK, 14), [todayK]);

  const noticeRule = useMemo((): { weeks: number; met: boolean } | null => {
    if (!startKey || !endKey) return null;
    const dur = durationDays(startKey, endKey);
    const notice = daysFromToday(startKey);
    if (dur >= 3) return { weeks: 3, met: notice >= 21 };
    return { weeks: 2, met: notice >= 14 };
  }, [startKey, endKey]);

  const canSubmit = Boolean(
    user && startKey && endKey && reason.trim() && !submitting &&
    endKey >= startKey && (noticeRule?.met ?? false),
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !canSubmit) return;
    if (endKey < startKey) {
      setError("End date must be on or after the start date.");
      return;
    }
    if (noticeRule && !noticeRule.met) {
      setError(`This request requires at least ${noticeRule.weeks} weeks notice.`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const newRequest: StoredHolidayRequest = {
        id,
        startDate: Timestamp.fromDate(keyToDate(startKey)),
        endDate: Timestamp.fromDate(keyToDate(endKey)),
        reason: reason.trim(),
        status: "pending",
        createdAt: Timestamp.now(),
      };
      await setDoc(
        doc(getDb(), "staff_onboarding", user.uid),
        {
          holidayRequests: arrayUnion(newRequest),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      setRequests((prev) => [
        {
          id,
          startDate: keyToDate(startKey),
          endDate: keyToDate(endKey),
          reason: reason.trim(),
          status: "pending",
          createdAt: new Date(),
        },
        ...prev,
      ]);
      setStartKey("");
      setEndKey("");
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <button
        type="button"
        className={styles.backBtn}
        onClick={() => router.push("/staff")}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        <span>Back</span>
      </button>

      <h1 className={styles.title}>Holiday Request</h1>

      <div className={styles.notAvailCard}>
        <div className={styles.notAvailHeader}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span className={styles.notAvailTitle}>Request Not Available</span>
        </div>
        <p className={styles.notAvailLead}>
          This holiday request cannot be submitted because it does not meet
          the required notice period.
        </p>
        <div className={styles.notAvailDivider} />
        <ul className={styles.notAvailList}>
          <li>
            1–2 consecutive days require at least{" "}
            <strong>2 weeks&rsquo;</strong> notice
          </li>
          <li>
            3+ consecutive days require at least{" "}
            <strong>3 weeks&rsquo;</strong> notice
          </li>
        </ul>
        <div className={styles.notAvailDivider} />
        <p className={styles.notAvailFooter}>
          If this is urgent, please speak to your manager directly.
        </p>
      </div>

      <form className={styles.form} onSubmit={handleSubmit}>
        <label className={styles.label} htmlFor="hr-start">Start Date</label>
        <button
          id="hr-start"
          type="button"
          className={`${styles.dateField} ${!startKey ? styles.dateFieldEmpty : ""}`}
          onClick={() => setPickerOpen("start")}
        >
          <span>{startKey ? fmtKey(startKey) : "Select start date"}</span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </button>

        <label className={styles.label} htmlFor="hr-end">End Date</label>
        <button
          id="hr-end"
          type="button"
          className={`${styles.dateField} ${!endKey ? styles.dateFieldEmpty : ""}`}
          onClick={() => setPickerOpen("end")}
        >
          <span>{endKey ? fmtKey(endKey) : "Select end date"}</span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </button>

        <label className={styles.label} htmlFor="hr-reason">Reason</label>
        <input
          id="hr-reason"
          className={styles.input}
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Family holiday"
        />

        {noticeRule && (
          <div className={`${styles.ruleHint} ${noticeRule.met ? styles.ruleHintOk : styles.ruleHintWarn}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <span>
              This request requires at least{" "}
              <strong>{noticeRule.weeks} weeks</strong> notice.
              {!noticeRule.met && " Please select a later start date."}
            </span>
          </div>
        )}

        {error && <p className={styles.error}>{error}</p>}

        <button
          type="submit"
          className={styles.submitBtn}
          disabled={!canSubmit}
        >
          {submitting ? "Submitting…" : "Submit Request"}
        </button>
      </form>

      <div className={styles.divider} />

      <h2 className={styles.subTitle}>Previous Requests</h2>

      {requests.length === 0 ? (
        <p className={styles.emptyText}>No previous requests yet.</p>
      ) : (
        <ul className={styles.requestList}>
          {requests.map((r) => (
            <li key={r.id} className={styles.requestRow}>
              <span className={styles.requestIcon} aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </span>
              <span className={styles.requestRange}>
                {fmtRange(r.startDate, r.endDate)}
              </span>
              <span className={`${styles.statusBadge} ${statusClass(r.status)}`}>
                {statusLabel(r.status)}
              </span>
              <span className={styles.requestChevron} aria-hidden="true">›</span>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.infoBox}>
        <span className={styles.infoIcon} aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </span>
        <p className={styles.infoBody}>
          You will be notified once your request has been reviewed.
        </p>
      </div>

      {pickerOpen && (
        <CalendarPicker
          value={
            pickerOpen === "start"
              ? (startKey || minStartKey)
              : (endKey || startKey || minStartKey)
          }
          maxDate={FAR_FUTURE_MAX}
          minDate={pickerOpen === "end" && startKey ? startKey : minStartKey}
          singleOnly
          onChange={(k) => {
            if (pickerOpen === "start") {
              setStartKey(k);
              // If end is now before the new start, clear it.
              if (endKey && endKey < k) setEndKey("");
            } else {
              setEndKey(k);
            }
          }}
          onRangeChange={() => { /* unused — singleOnly */ }}
          onClose={() => setPickerOpen(null)}
        />
      )}
    </div>
  );
}
