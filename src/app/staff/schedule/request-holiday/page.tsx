"use client";

import { useEffect, useMemo, useState } from "react";
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
import { useLang } from "@/components/LanguageProvider";
import CalendarPicker from "@/components/CalendarPicker";
import RequestSubmitted from "@/components/RequestSubmitted";
import { useBackTo } from "@/hooks/useBackTo";
import { NOTICE_DAYS, NOTICE_WEEKS } from "@/lib/notice-period";
import { ROUTES } from "@/lib/routes";
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

/*
 * The notice a holiday request needs is NOTICE_WEEKS, shared with the
 * availability form. It used to turn on how long the holiday was — three weeks
 * for three days or more, two for anything shorter — which is why the length
 * of the request was worked out at all. It is a flat figure now, so the length
 * no longer decides anything and `durationDays` went with it.
 */

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

/** With the weekday, for the confirmation — the day of the week is the part
 *  somebody checks when they are reading back a holiday they just booked. */
function fmtKeyWithWeekday(key: string): string {
  return keyToDate(key).toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * How many days the holiday covers, counting both ends.
 *
 * Display only — the notice rule is a flat two weeks and no longer turns on
 * length. Safe across a daylight-saving boundary because keyToDate anchors
 * every date at local noon, so the difference is never 23 or 25 hours.
 */
function durationDays(startKey: string, endKey: string): number {
  const ms = keyToDate(endKey).getTime() - keyToDate(startKey).getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24)) + 1;
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

function statusLabelKey(status: HolidayRequest["status"]): string {
  switch (status) {
    case "approved": return "rh.status.approved";
    case "pending":  return "rh.status.pending";
    case "declined": return "rh.status.declined";
    default:         return "rh.status.pending";
  }
}

export default function RequestHolidayPage() {
  const { user } = useAuth();
  const { t } = useLang();
  // Requests is the list this form is opened from, so it is both where Back
  // returns to and where Done lands once the request has gone in.
  const goToRequests = useBackTo(ROUTES.staffRequests);

  const [startKey, setStartKey] = useState<string>("");
  const [endKey, setEndKey] = useState<string>("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<HolidayRequest[]>([]);
  const [pickerOpen, setPickerOpen] = useState<null | "start" | "end">(null);
  /** What was just filed, kept so the confirmation can read it back. */
  const [submitted, setSubmitted] = useState<
    null | { startKey: string; endKey: string; reason: string }
  >(null);

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
  // Block the calendar to the notice window, so an impossible start date is
  // not offered in the first place.
  const minStartKey = useMemo(() => addDays(todayK, NOTICE_DAYS), [todayK]);

  // Checked again here rather than left to the calendar: the picker's floor
  // is worked out once on mount, so a page left open overnight would still
  // be offering yesterday's earliest date.
  const noticeMet = useMemo((): boolean | null => {
    if (!startKey || !endKey) return null;
    return daysFromToday(startKey) >= NOTICE_DAYS;
  }, [startKey, endKey]);

  const canSubmit = Boolean(
    user && startKey && endKey && reason.trim() && !submitting &&
    endKey >= startKey && (noticeMet ?? false),
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !canSubmit) return;
    if (endKey < startKey) {
      setError(t("rh.endBeforeStart"));
      return;
    }
    if (noticeMet === false) {
      setError(t("rh.needsWeeksNotice").replace("{n}", String(NOTICE_WEEKS)));
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
      setSubmitted({ startKey, endKey, reason: reason.trim() });
      setStartKey("");
      setEndKey("");
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    const days = durationDays(submitted.startKey, submitted.endKey);
    // One date when the holiday is a single day, so it is not printed twice.
    const dates =
      submitted.startKey === submitted.endKey
        ? [fmtKeyWithWeekday(submitted.startKey)]
        : [fmtKeyWithWeekday(submitted.startKey), fmtKeyWithWeekday(submitted.endKey)];
    return (
      <RequestSubmitted
        highlightLabel={t("rh.sub.dates")}
        highlightValues={dates}
        sections={[
          {
            title: t("rh.sub.summary"),
            rows: [
              {
                label: t("rh.sub.duration"),
                value: t(days === 1 ? "rh.sub.durationDay" : "rh.sub.durationDays")
                  .replace("{n}", String(days)),
              },
              { label: t("rh.reason"), value: submitted.reason },
            ],
          },
        ]}
        onDone={goToRequests}
      />
    );
  }

  return (
    <div className={styles.page}>
      <button
        type="button"
        className={styles.backBtn}
        onClick={goToRequests}
        aria-label={t("common.back")}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        <span>{t("common.back")}</span>
      </button>

      <h1 className={styles.title}>{t("rh.title")}</h1>

      <div className={styles.noticeBox}>
        <div className={styles.noticeHeader}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <span className={styles.noticeTitle}>{t("rh.notice")}</span>
        </div>
        <div className={styles.noticeRow}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <p className={styles.noticeText}>
            {t("rh.noticeBefore")}
            <span className={styles.noticeAccent}>{t("rh.noticeWeeks")}</span>{t("rh.noticeAfter")}
          </p>
        </div>
      </div>

      <form className={styles.form} onSubmit={handleSubmit}>
        <label className={styles.label} htmlFor="hr-start">{t("rh.startDate")}</label>
        <button
          id="hr-start"
          type="button"
          className={`${styles.dateField} ${!startKey ? styles.dateFieldEmpty : ""}`}
          onClick={() => setPickerOpen("start")}
        >
          <span>{startKey ? fmtKey(startKey) : t("rh.selectStart")}</span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </button>

        <label className={styles.label} htmlFor="hr-end">{t("rh.endDate")}</label>
        <button
          id="hr-end"
          type="button"
          className={`${styles.dateField} ${!endKey ? styles.dateFieldEmpty : ""}`}
          onClick={() => setPickerOpen("end")}
        >
          <span>{endKey ? fmtKey(endKey) : t("rh.selectEnd")}</span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </button>

        <label className={styles.label} htmlFor="hr-reason">{t("rh.reason")}</label>
        <input
          id="hr-reason"
          className={styles.input}
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("rh.reasonPlaceholder")}
        />

        {noticeMet !== null && (
          <div className={`${styles.ruleHint} ${noticeMet ? styles.ruleHintOk : styles.ruleHintWarn}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <span className={styles.ruleHintText}>
              <span>
                {t("rh.ruleRequires")}
                <strong>{NOTICE_WEEKS}{t("rh.ruleWeeksSuffix")}</strong>{t("rh.ruleNotice")}
                {!noticeMet && t("rh.rulePickLater")}
              </span>
              <span className={styles.ruleHintFooter}>
                {t("rh.ruleUrgentNote")}
              </span>
            </span>
          </div>
        )}

        {error && <p className={styles.error}>{error}</p>}

        <button
          type="submit"
          className={styles.submitBtn}
          disabled={!canSubmit}
        >
          {submitting ? t("rh.submitting") : t("rh.submit")}
        </button>
      </form>

      <div className={styles.divider} />

      <h2 className={styles.subTitle}>{t("rh.previous")}</h2>

      {requests.length === 0 ? (
        <p className={styles.emptyText}>{t("rh.empty")}</p>
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
                {t(statusLabelKey(r.status))}
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
        <p className={styles.infoBody}>{t("rh.reviewNote")}</p>
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
