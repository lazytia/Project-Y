"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, getDocs, type Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { isOwner } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import { registerFcmToken } from "@/lib/fcm";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

type StaffOnboarding = {
  uid: string;
  firstName?: string;
  lastName?: string;
  preferredName?: string;
  email?: string;
  role?: string;
  startDate?: Date | null;
  completedStep?: number;
  step?: number;
  documents?: {
    passportUrl?: string | null;
    visaUrl?: string | null;
    rsaUrl?: string | null;
  };
  taxFileNumber?: string;
  bankSuper?: { bsb?: string };
};

const TOTAL_STEPS = 7;

function tsToDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object" && v !== null && "toDate" in v) {
    return (v as Timestamp).toDate();
  }
  return null;
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Onboarding due date = Wednesday of the calendar week AFTER the start date.
 * Matches the payroll cut-off logic used on the staff /onboarding overview.
 */
function calcDueDate(startDate: Date | null | undefined): Date | null {
  if (!startDate) return null;
  const d = new Date(startDate);
  const dow = d.getDay(); // 0=Sun … 6=Sat
  const daysToNextMonday = dow === 0 ? 1 : 8 - dow;
  d.setDate(d.getDate() + daysToNextMonday + 2); // Mon + 2 = Wed
  return d;
}

function initials(row: StaffOnboarding): string {
  const f = (row.firstName ?? "").trim();
  const l = (row.lastName ?? "").trim();
  if (f || l) return `${f.charAt(0)}${l.charAt(0)}`.toUpperCase();
  const e = row.email ?? "";
  return e.slice(0, 2).toUpperCase() || "??";
}

function fullName(row: StaffOnboarding): string {
  const f = (row.firstName ?? "").trim();
  const l = (row.lastName ?? "").trim();
  if (f || l) return [f, l].filter(Boolean).join(" ");
  return row.email ?? row.uid;
}

/** First incomplete item we can flag for the manager. */
function firstMissing(row: StaffOnboarding): string | null {
  if (!row.documents?.passportUrl) return "Passport / Photo ID";
  if (!row.documents?.visaUrl) return "Visa";
  if (!row.documents?.rsaUrl) return "RSA Certificate";
  if (!row.taxFileNumber) return "TFN Declaration";
  if (!row.bankSuper?.bsb) return "Bank & Super Details";
  return null;
}

function isPendingApproval(row: StaffOnboarding): boolean {
  return (row.completedStep ?? 0) >= TOTAL_STEPS;
}

export default function ManagerOnboardingPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwner(user);

  const [rows, setRows] = useState<StaffOnboarding[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Owner-only page: redirect anyone else back to the dashboard.
  useEffect(() => {
    if (authLoading) return;
    if (!allowed) router.replace(ROUTES.home);
  }, [allowed, authLoading, router]);

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(collection(getDb(), "staff_onboarding"));
        const data: StaffOnboarding[] = snap.docs.map((d) => {
          const raw = d.data() as Record<string, unknown>;
          return {
            uid: d.id,
            firstName: raw.firstName as string | undefined,
            lastName: raw.lastName as string | undefined,
            preferredName: raw.preferredName as string | undefined,
            email: raw.email as string | undefined,
            role: raw.role as string | undefined,
            startDate: tsToDate(raw.startDate),
            completedStep: raw.completedStep as number | undefined,
            step: raw.step as number | undefined,
            documents: raw.documents as StaffOnboarding["documents"],
            taxFileNumber: raw.taxFileNumber as string | undefined,
            bankSuper: raw.bankSuper as StaffOnboarding["bankSuper"],
          };
        });
        if (cancelled) return;
        // Owners might have a doc here (for FCM tokens) — keep those out of the staff list.
        const staffOnly = data.filter((r) => r.role !== "owner");
        // Sort by start date ascending (soonest first), unknowns last.
        staffOnly.sort((a, b) => {
          const at = a.startDate?.getTime() ?? Infinity;
          const bt = b.startDate?.getTime() ?? Infinity;
          return at - bt;
        });
        setRows(staffOnly);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      }
    })();
    return () => { cancelled = true; };
  }, [allowed]);

  const pendingApprovalCount = useMemo(
    () => rows?.filter(isPendingApproval).length ?? 0,
    [rows],
  );
  const activeCount = useMemo(() => rows?.length ?? 0, [rows]);

  async function handleRemind(row: StaffOnboarding) {
    if (!user) return;
    try {
      // Register owner's token (user gesture → iOS permission prompt fires here)
      try { await registerFcmToken(user.uid); } catch { /* best-effort */ }

      const res = await fetch("/api/staff/remind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uids: [row.uid, user.uid] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(`Reminder failed: ${data.error ?? res.status}`);
        return;
      }
      if (data.delivered > 0) {
        alert("Reminder sent.");
      } else {
        alert(
          data.reason ??
            "No device registered yet. Open the app and allow notifications first.",
        );
      }
    } catch (err) {
      alert(`Reminder failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (authLoading || !allowed) {
    return <Splash />;
  }

  return (
    <div className={styles.page}>
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <span className={styles.crumbDim}>People</span>
        <span className={styles.crumbSep}>›</span>
        <span className={styles.crumb}>Onboarding</span>
      </nav>

      <section className={styles.section}>
        <p className={styles.sectionLabel}>UPCOMING STARTS</p>
        <p className={styles.sectionSub}>
          {rows == null ? "Loading…" : `${activeCount} active onboarding`}
        </p>
      </section>

      {error && <p className={styles.error}>{error}</p>}

      <ul className={styles.list}>
        {rows?.map((row) => {
          const pending = isPendingApproval(row);
          const missing = pending ? null : firstMissing(row);
          const due = calcDueDate(row.startDate);
          return (
            <li key={row.uid} className={styles.card}>
              <div className={styles.avatar} aria-hidden="true">
                {initials(row)}
              </div>
              <div className={styles.cardBody}>
                <h3 className={styles.name}>{fullName(row)}</h3>
                <div className={styles.metaRow}>
                  <span className={styles.metaItem}>
                    <span className={styles.metaIcon} aria-hidden="true">📅</span>
                    Start {fmtDate(row.startDate)}
                  </span>
                  {!pending && (
                    <>
                      <span className={styles.metaDivider} aria-hidden="true" />
                      <span className={styles.metaItem}>
                        <span className={styles.metaIcon} aria-hidden="true">🕐</span>
                        Due {fmtDate(due)}
                      </span>
                    </>
                  )}
                </div>
                {pending ? (
                  <p className={styles.statusPending}>Pending Approval</p>
                ) : missing ? (
                  <p className={styles.statusMissing}>Missing: {missing}</p>
                ) : (
                  <p className={styles.statusReady}>Ready for approval</p>
                )}
              </div>
              <div className={styles.cardAction}>
                {pending ? (
                  <span className={styles.pendingPill} aria-label="Pending approval">
                    <ClockIcon />
                  </span>
                ) : (
                  <button
                    type="button"
                    className={styles.remindBtn}
                    onClick={() => handleRemind(row)}
                  >
                    Remind
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {pendingApprovalCount > 0 && (
        <button type="button" className={styles.pendingCta}>
          <span className={styles.pendingCtaIcon}>
            <ClockIcon />
          </span>
          <span className={styles.pendingCtaBody}>
            <span className={styles.pendingCtaTitle}>
              {pendingApprovalCount} Pending Approval{pendingApprovalCount === 1 ? "" : "s"}
            </span>
            <span className={styles.pendingCtaSub}>Requires manager approval</span>
          </span>
          <span className={styles.pendingCtaChevron}>›</span>
        </button>
      )}
    </div>
  );
}

function ClockIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
