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
import styles from "./page.module.css";

type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

const DAYS: { key: DayKey; short: string; long: string }[] = [
  { key: "mon", short: "Mon", long: "Monday" },
  { key: "tue", short: "Tue", long: "Tuesday" },
  { key: "wed", short: "Wed", long: "Wednesday" },
  { key: "thu", short: "Thu", long: "Thursday" },
  { key: "fri", short: "Fri", long: "Friday" },
  { key: "sat", short: "Sat", long: "Saturday" },
  { key: "sun", short: "Sun", long: "Sunday" },
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

function labelFor(a: Availability): string {
  switch (a.kind) {
    case "available": return "Available";
    case "unavailable": return "Unavailable";
    case "partial": return `${fmtTime12h(a.from)} – ${fmtTime12h(a.until)}`;
  }
}

export default function AvailabilityChangePage() {
  const router = useRouter();
  const { user } = useAuth();

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
    if (submitting || !reason.trim()) return false;
    return JSON.stringify(current) !== JSON.stringify(proposed);
  }, [submitting, reason, current, proposed]);

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
            reason: reason.trim(),
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
        <span>Back</span>
      </button>

      <h1 className={styles.title}>Availability Change</h1>

      <div className={styles.infoBox}>
        <span className={styles.infoIcon} aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </span>
        <p className={styles.infoBody}>
          Availability changes should be submitted at least 3 weeks in advance.
        </p>
      </div>

      {/* Current Availability */}
      <h2 className={styles.sectionTitle}>Current Availability</h2>
      <div className={styles.currentList}>
        {DAYS.map((d) => {
          const a = current[d.key];
          const isAvail = a.kind === "available";
          const isPartial = a.kind === "partial";
          return (
            <div key={d.key} className={styles.currentRow}>
              <span className={styles.currentDay}>{d.short}</span>
              <span
                className={`${styles.currentBadge} ${
                  isAvail ? styles.badgeAvailable : isPartial ? styles.badgePartial : styles.badgeUnavailable
                }`}
              >
                {isAvail ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="9 12 11 14 15 10" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                  </svg>
                )}
                {labelFor(a)}
              </span>
            </div>
          );
        })}
      </div>

      {/* New Availability */}
      <h2 className={styles.sectionTitle}>New Availability</h2>
      <div className={styles.proposeList}>
        {DAYS.map((d) => {
          const a = proposed[d.key];
          return (
            <div key={d.key} className={styles.proposeRow}>
              <span className={styles.proposeDay}>{d.short}</span>
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
                  Available All Day
                </button>
                <button
                  type="button"
                  className={`${styles.choice} ${a.kind === "partial" ? styles.choicePartialActive : ""}`}
                  onClick={() => handleChoose(d.key, "partial")}
                >
                  Available Partially
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
                  Unavailable
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
        <label className={styles.label} htmlFor="ac-reason">Reason</label>
        <input
          id="ac-reason"
          className={styles.input}
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. New study schedule"
        />

        {error && <p className={styles.error}>{error}</p>}

        <button
          type="submit"
          className={styles.submitBtn}
          disabled={!canSubmit || !loaded}
        >
          {submitting ? "Submitting…" : "Submit Availability Change"}
        </button>
      </form>

      <div className={styles.infoBox}>
        <span className={styles.infoIcon} aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </span>
        <p className={styles.infoBody}>
          Availability changes are requests only and are not approved until
          confirmed by management.
        </p>
      </div>

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
  const long = DAYS.find((d) => d.key === day)?.long ?? "Day";
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
            <h3 className={styles.sheetTitle}>{long} Availability</h3>
            <p className={styles.sheetSub}>
              You have selected: <span className={styles.sheetSubAccent}>Available Partially</span>
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

        <label className={styles.sheetLabel} htmlFor="ac-from">Available From</label>
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

        <label className={styles.sheetLabel} htmlFor="ac-until">Available Until</label>
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
          <p className={styles.sheetInfoBody}>
            Please ensure the times reflect when you are available to work.
          </p>
        </div>

        <button
          type="button"
          className={styles.sheetSaveBtn}
          disabled={!valid}
          onClick={() => onSave(from, until)}
        >
          Save
        </button>
      </div>
    </div>
  );
}
