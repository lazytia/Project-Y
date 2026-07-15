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
import { useLang } from "@/components/LanguageProvider";
import styles from "./page.module.css";

type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

/** Days of the week. Short/long labels are translation KEYS rather
 *  than fixed strings so the page renders in EN or JA per the toggle. */
const DAYS: { key: DayKey; shortKey: string; longKey: string }[] = [
  { key: "mon", shortKey: "ac.day.mon", longKey: "ac.dayLong.mon" },
  { key: "tue", shortKey: "ac.day.tue", longKey: "ac.dayLong.tue" },
  { key: "wed", shortKey: "ac.day.wed", longKey: "ac.dayLong.wed" },
  { key: "thu", shortKey: "ac.day.thu", longKey: "ac.dayLong.thu" },
  { key: "fri", shortKey: "ac.day.fri", longKey: "ac.dayLong.fri" },
  { key: "sat", shortKey: "ac.day.sat", longKey: "ac.dayLong.sat" },
  { key: "sun", shortKey: "ac.day.sun", longKey: "ac.dayLong.sun" },
];

type Availability =
  | { kind: "available" }
  | { kind: "unavailable" }
  | { kind: "partial"; from: string; until: string }; // HH:MM (24h)

type AvailabilityMap = Record<DayKey, Availability>;

const DEFAULT_AVAILABILITY: AvailabilityMap = {
  mon: { kind: "available" },
  tue: { kind: "available" },
  wed: { kind: "available" },
  thu: { kind: "available" },
  fri: { kind: "available" },
  sat: { kind: "unavailable" },
  sun: { kind: "unavailable" },
};

/** Parse a possibly-malformed availability dict from Firestore. */
function normalize(raw: unknown): AvailabilityMap {
  const out: AvailabilityMap = { ...DEFAULT_AVAILABILITY };
  if (!raw || typeof raw !== "object") return out;
  const obj = raw as Record<string, unknown>;
  for (const { key } of DAYS) {
    const v = obj[key];
    if (typeof v === "string") {
      if (v === "available" || v === "unavailable") out[key] = { kind: v };
    } else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const kind = o.kind;
      if (kind === "available" || kind === "unavailable") {
        out[key] = { kind };
      } else if (
        kind === "partial" &&
        typeof o.from === "string" &&
        typeof o.until === "string"
      ) {
        out[key] = { kind: "partial", from: o.from, until: o.until };
      }
    }
  }
  return out;
}

function fmtTime12h(t: string): string {
  // "17:00" → "5:00 PM"
  if (!/^\d{1,2}:\d{2}$/.test(t)) return t;
  const [hStr, mStr] = t.split(":");
  let h = parseInt(hStr, 10);
  const m = mStr;
  const period = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${period}`;
}

/** Returns the Monday that is at least 21 days from today. */
function nextMondayAfter3Weeks(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 21);
  const dow = d.getDay(); // 0=Sun…6=Sat
  if (dow !== 1) d.setDate(d.getDate() + ((1 + 7 - dow) % 7 || 7));
  return d;
}

function fmtEffective(d: Date): string {
  return d.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function AvailabilityChangePage() {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useLang();
  const [effectiveDate, setEffectiveDate] = useState<Date>(() => {
    const d = new Date(0);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  useEffect(() => {
    setEffectiveDate(nextMondayAfter3Weeks());
  }, []);

  const [current, setCurrent] = useState<AvailabilityMap>(DEFAULT_AVAILABILITY);
  const [proposed, setProposed] = useState<AvailabilityMap>(DEFAULT_AVAILABILITY);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editingDay, setEditingDay] = useState<DayKey | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const snap = await getDoc(doc(getDb(), "staff_onboarding", user.uid));
        const data = snap.data() ?? {};
        const cur = normalize(data.availability);
        setCurrent(cur);
        setProposed(cur);
      } catch {
        /* keep defaults */
      } finally {
        setLoaded(true);
      }
    })();
  }, [user]);

  function setDay(key: DayKey, a: Availability) {
    setProposed((p) => ({ ...p, [key]: a }));
  }

  function handleChoose(key: DayKey, kind: Availability["kind"]) {
    if (kind === "available") setDay(key, { kind: "available" });
    else if (kind === "unavailable") setDay(key, { kind: "unavailable" });
    else if (kind === "partial") setEditingDay(key);
  }

  const canSubmit = useMemo(() => {
    if (submitting) return false;
    return JSON.stringify(current) !== JSON.stringify(proposed);
  }, [submitting, current, proposed]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await setDoc(
        doc(getDb(), "staff_onboarding", user.uid),
        {
          availabilityRequests: arrayUnion({
            id,
            requested: proposed,
            previousAvailability: current,
            reason: reason.trim() || null,
            effectiveDate: Timestamp.fromDate(effectiveDate),
            status: "pending",
            createdAt: Timestamp.now(),
          }),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      router.push("/staff");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit.");
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
        <span>{t("common.back")}</span>
      </button>

      <h1 className={styles.title}>{t("ac.title")}</h1>

      <div className={styles.infoBox}>
        <span className={styles.infoIcon} aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </span>
        <p className={styles.infoBody}>{t("ac.notice")}</p>
      </div>

      {/* Effective From card */}
      <div className={styles.effectiveCard}>
        <div className={styles.effectiveIconWrap} aria-hidden="true">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </div>
        <div className={styles.effectiveBody}>
          <p className={styles.effectiveLabel}>{t("ac.effectiveFrom")}</p>
          <p className={styles.effectiveDate}>{fmtEffective(effectiveDate)}</p>
          <span className={styles.effectiveBadge}>{t("ac.subjectApproval")}</span>
          <p className={styles.effectiveNote}>{t("ac.effectiveNote")}</p>
        </div>
      </div>

      {/* Availability */}
      <h2 className={styles.sectionTitle}>{t("ac.section")}</h2>
      <div className={styles.proposeList}>
        {DAYS.map((d) => {
          const a = proposed[d.key];
          return (
            <div key={d.key} className={styles.proposeRow}>
              <span className={styles.proposeDay}>{t(d.shortKey)}</span>
              <div className={styles.proposeChoices}>
                <button
                  type="button"
                  className={`${styles.choice} ${a.kind === "available" ? styles.choiceAvailableActive : ""}`}
                  onClick={() => handleChoose(d.key, "available")}
                >
                  {a.kind === "available" && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="9 12 11 14 15 10" />
                    </svg>
                  )}
                  {t("ac.allDay")}
                </button>
                <button
                  type="button"
                  className={`${styles.choice} ${a.kind === "partial" ? styles.choicePartialActive : ""}`}
                  onClick={() => handleChoose(d.key, "partial")}
                >
                  {t("ac.partially")}
                </button>
                <button
                  type="button"
                  className={`${styles.choice} ${a.kind === "unavailable" ? styles.choiceUnavailableActive : ""}`}
                  onClick={() => handleChoose(d.key, "unavailable")}
                >
                  {a.kind === "unavailable" && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="9" y1="9" x2="15" y2="15" />
                      <line x1="15" y1="9" x2="9" y2="15" />
                    </svg>
                  )}
                  {t("ac.unavailable")}
                </button>
              </div>
              {a.kind === "partial" && (
                <p className={styles.partialSummary}>
                  {fmtTime12h(a.from)} – {fmtTime12h(a.until)}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <form className={styles.form} onSubmit={handleSubmit}>
        <label className={styles.label} htmlFor="ac-reason">{t("ac.reason")}</label>
        <input
          id="ac-reason"
          className={styles.input}
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("ac.reasonPlaceholder")}
        />

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.infoBoxWarm}>
          <span className={styles.infoIcon} aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          </span>
          <p className={styles.infoBody}>{t("ac.pendingWarning")}</p>
        </div>

        <button
          type="submit"
          className={styles.submitBtn}
          disabled={!canSubmit || !loaded}
        >
          {submitting ? t("ac.submitting") : t("ac.submit")}
        </button>
      </form>

      {editingDay && (
        <PartialSheet
          day={editingDay}
          initial={
            proposed[editingDay].kind === "partial"
              ? (proposed[editingDay] as { from: string; until: string })
              : { from: "17:00", until: "22:00" }
          }
          onCancel={() => setEditingDay(null)}
          onSave={(from, until) => {
            setDay(editingDay, { kind: "partial", from, until });
            setEditingDay(null);
          }}
        />
      )}
    </div>
  );
}

/* ── Bottom-sheet modal for partial availability time entry ── */

function PartialSheet({
  day,
  initial,
  onCancel,
  onSave,
}: {
  day: DayKey;
  initial: { from: string; until: string };
  onCancel: () => void;
  onSave: (from: string, until: string) => void;
}) {
  const { t } = useLang();
  const longKey = DAYS.find((d) => d.key === day)?.longKey ?? "ac.dayLong.mon";
  const long = t(longKey);
  const [from, setFrom] = useState(initial.from);
  const [until, setUntil] = useState(initial.until);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onCancel(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const valid = from && until && from < until;

  return (
    <div
      className={styles.sheetBackdrop}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      role="dialog"
      aria-modal="true"
      aria-label={`${long} availability`}
    >
      <div className={styles.sheet}>
        <div className={styles.sheetHandle} />

        <div className={styles.sheetHeader}>
          <div>
            <h3 className={styles.sheetTitle}>{long}{t("ac.availabilitySuffix")}</h3>
            <p className={styles.sheetSub}>
              {t("ac.selectedIntro")}<span className={styles.sheetSubAccent}>{t("ac.availPartially")}</span>
            </p>
          </div>
          <button
            type="button"
            className={styles.sheetClose}
            onClick={onCancel}
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className={styles.sheetDivider} />

        <label className={styles.sheetLabel} htmlFor="ac-from">{t("ac.availableFrom")}</label>
        <div className={styles.timeWrap}>
          <input
            id="ac-from"
            type="time"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className={styles.timeInput}
          />
          <svg className={styles.timeIcon} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>

        <label className={styles.sheetLabel} htmlFor="ac-until">{t("ac.availableUntil")}</label>
        <div className={styles.timeWrap}>
          <input
            id="ac-until"
            type="time"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            className={styles.timeInput}
          />
          <svg className={styles.timeIcon} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>

        <div className={styles.sheetInfoBox}>
          <span className={styles.infoIcon} aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          </span>
          <p className={styles.sheetInfoBody}>{t("ac.partialTimeNote")}</p>
        </div>

        <button
          type="button"
          className={styles.sheetSaveBtn}
          disabled={!valid}
          onClick={() => onSave(from, until)}
        >
          {t("ac.save")}
        </button>
      </div>
    </div>
  );
}
