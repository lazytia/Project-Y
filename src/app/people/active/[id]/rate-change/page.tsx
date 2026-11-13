"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { useBackTo } from "@/hooks/useBackTo";
import { isChef, isOwner } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import { RATE_NOTICE_DAYS, ratesOn, readStaffRates, type StaffRates } from "@/lib/staff-rates";
import { saveRateChange } from "@/lib/rate-change-store";
import { startDateISO } from "@/lib/staff-training";
import { addDaysISO, sydneyTodayKey } from "@/lib/sydney-date";
import CalendarPicker from "@/components/CalendarPicker";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

/** How far ahead a change can be set. */
const MAX_DAYS_AHEAD = 730;

type Loaded = {
  name: string;
  rates: StaffRates;
  /** First day they worked, or "" — no change can start before it. */
  startISO: string;
};

function fullNameOf(raw: Record<string, unknown>): string {
  const fn = typeof raw.fullName === "string" ? raw.fullName.trim() : "";
  if (fn) return fn;
  const f = typeof raw.firstName === "string" ? raw.firstName.trim() : "";
  const l = typeof raw.lastName === "string" ? raw.lastName.trim() : "";
  return [f, l].filter(Boolean).join(" ") || "Employee";
}

function fmtIsoLong(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtCurrent(n: number | null): string {
  return n != null ? `Current $${n.toFixed(2)} /hr` : "Current —";
}

function draftOf(n: number | null): string {
  return n != null ? n.toFixed(2) : "";
}

/** A typed rate in dollars, null when blank, NaN when not a usable rate. */
function parseRate(draft: string): number | null {
  const t = draft.trim();
  if (!t) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : Number.NaN;
}

/**
 * Schedule a new pair of rates from a chosen day, or edit one already
 * scheduled (`?from=YYYY-MM-DD`). Nothing is overwritten: the change sits
 * beside the current rates until its day comes, the employee's payslip page
 * announces it in the week before, and every shift is paid at the rate of
 * the day it was worked.
 */
function ScheduleRateChangeInner() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const id = params?.id ?? "";
  const editingFrom = search.get("from") ?? "";
  const employeeHref = `/people/active/${id}`;
  const goBack = useBackTo(employeeHref);
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwner(user) || isChef(user);

  const today = sydneyTodayKey();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [weekday, setWeekday] = useState("");
  const [saturday, setSaturday] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(() => addDaysISO(today, RATE_NOTICE_DAYS));
  const [calOpen, setCalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!allowed) router.replace(ROUTES.home);
  }, [allowed, authLoading, router]);

  useEffect(() => {
    if (!allowed || !id) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(getDb(), "staff_onboarding", id));
        if (!snap.exists()) {
          if (!cancelled) setNotFound(true);
          return;
        }
        const raw = snap.data() as Record<string, unknown>;
        const rates = readStaffRates(raw);
        // Editing starts from what was scheduled; a new change starts from
        // today's rates, since a raise is usually a small step from them.
        const editing = rates.changes.find((c) => c.effectiveFrom === editingFrom);
        if (cancelled) return;
        setLoaded({ name: fullNameOf(raw), rates, startISO: startDateISO(raw) });
        setWeekday(draftOf(editing ? editing.weekday : rates.weekday));
        setSaturday(draftOf(editing ? editing.saturday : rates.saturday));
        if (editing) setEffectiveFrom(editing.effectiveFrom);
      } catch {
        if (!cancelled) setNotFound(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allowed, id, editingFrom]);

  async function handleSave() {
    if (!loaded || saving) return;
    const newWeekday = parseRate(weekday);
    const newSaturday = parseRate(saturday);
    if (newWeekday === null || Number.isNaN(newWeekday)) {
      alert("Please enter a valid weekday rate.");
      return;
    }
    if (Number.isNaN(newSaturday)) {
      alert("Please enter a valid Saturday rate, or leave it blank.");
      return;
    }
    // A backdated change is allowed — a raise agreed late still pays from the
    // day it was meant to — but not one from before they started.
    if (loaded.startISO && effectiveFrom < loaded.startISO) {
      alert("The new rate can't start before the employee's start date.");
      return;
    }
    // Compared with what is paid the day before, ignoring the change being
    // edited — otherwise moving a change's date would read as "no change".
    const others = loaded.rates.changes.filter((c) => c.effectiveFrom !== editingFrom);
    const before = ratesOn({ base: loaded.rates.base, changes: others }, addDaysISO(effectiveFrom, -1));
    if (before.weekday === newWeekday && before.saturday === newSaturday) {
      alert("These are already the rates on that day.");
      return;
    }

    setSaving(true);
    try {
      await saveRateChange(
        id,
        { effectiveFrom, weekday: newWeekday, saturday: newSaturday },
        {
          replacing: editingFrom || undefined,
          scheduledBy:
            user?.displayName?.trim() || (user?.email ? user.email.split("@")[0] : "Owner"),
        },
      );
      router.push(employeeHref);
    } catch (err) {
      console.error("[rate-change] save failed:", err);
      alert("Failed to schedule the rate change. Please try again.");
      setSaving(false);
    }
  }

  if (authLoading || !allowed) return <Splash />;

  if (notFound) {
    return (
      <div className={styles.page}>
        <TopBar onBack={goBack} name="" />
        <p className={styles.notFound}>This employee record no longer exists.</p>
      </div>
    );
  }

  if (!loaded) return <Splash label="Loading…" />;

  return (
    <div className={styles.page}>
      <TopBar onBack={goBack} name={loaded.name} />

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Weekday Rate</span>
        <span className={styles.inputWrap}>
          <span className={styles.inputPrefix} aria-hidden="true">$</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            className={styles.input}
            value={weekday}
            onChange={(e) => setWeekday(e.target.value)}
          />
        </span>
        <span className={styles.fieldHint}>{fmtCurrent(loaded.rates.weekday)}</span>
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Saturday Rate</span>
        <span className={styles.inputWrap}>
          <span className={styles.inputPrefix} aria-hidden="true">$</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            className={styles.input}
            value={saturday}
            onChange={(e) => setSaturday(e.target.value)}
          />
        </span>
        <span className={styles.fieldHint}>{fmtCurrent(loaded.rates.saturday)}</span>
      </label>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>Effective From</span>
        <button type="button" className={styles.dateBtn} onClick={() => setCalOpen(true)}>
          <span>{fmtIsoLong(effectiveFrom)}</span>
          <CalendarIcon />
        </button>
        <span className={styles.fieldHint}>Applies to hours worked from this date.</span>
      </div>

      <div className={styles.divider} aria-hidden="true" />

      <p className={styles.notice}>
        <CheckCircleIcon />
        Payslip notice added automatically
      </p>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primaryBtn}
          onClick={() => void handleSave()}
          disabled={saving}
        >
          {saving ? "Saving…" : "Schedule Change"}
        </button>
        <button type="button" className={styles.cancelBtn} onClick={goBack} disabled={saving}>
          Cancel
        </button>
      </div>

      {calOpen && (
        <CalendarPicker
          value={effectiveFrom}
          minDate={loaded.startISO || undefined}
          maxDate={addDaysISO(today, MAX_DAYS_AHEAD)}
          singleOnly
          onChange={(iso) => {
            setEffectiveFrom(iso);
            setCalOpen(false);
          }}
          onRangeChange={() => {}}
          onClose={() => setCalOpen(false)}
        />
      )}
    </div>
  );
}

export default function ScheduleRateChangePage() {
  return (
    <Suspense fallback={<Splash />}>
      <ScheduleRateChangeInner />
    </Suspense>
  );
}

function TopBar({ onBack, name }: { onBack: () => void; name: string }) {
  return (
    <div className={styles.topBar}>
      <button type="button" className={styles.iconBtn} onClick={onBack} aria-label="Back">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <div className={styles.topText}>
        <h1 className={styles.topTitle}>Schedule Rate Change</h1>
        {name && <p className={styles.topSub}>{name}</p>}
      </div>
      <span aria-hidden="true" />
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polyline points="8 12.5 11 15.5 16.5 9.5" />
    </svg>
  );
}
