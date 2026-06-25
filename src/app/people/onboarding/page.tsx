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
  fullName?: string;
  firstName?: string;
  lastName?: string;
  preferredName?: string;
  username?: string;
  email?: string;
  role?: string;
  position?: string;
  status?: string;
  startDate?: Date | null;
  trainingRate?: number;
  afterTrainingRate?: number;
  trainingPeriod?: string;
  completedStep?: number;
  step?: number;
  documents?: {
    passportUrl?: string | null;
    visaUrl?: string | null;
    rsaUrl?: string | null;
  };
  taxFileNumber?: string;
  bankSuper?: { bsb?: string };
  createdAt?: Date | null;
};

const TOTAL_STEPS = 7;

/** Username derived from the synthetic auth email, or the stored field. */
function usernameOf(row: StaffOnboarding): string {
  if (row.username) return row.username;
  const email = row.email ?? "";
  const at = email.indexOf("@");
  return at === -1 ? email : email.slice(0, at);
}

/** Accepts Firestore Timestamp, JS Date, or an ISO date string. */
function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "string") {
    const [y, m, d] = v.split("-").map(Number);
    if (y && m && d) return new Date(y, m - 1, d);
    const parsed = new Date(v);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof v === "object" && v !== null && "toDate" in v) {
    try {
      return (v as Timestamp).toDate();
    } catch {
      return null;
    }
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

function fmtRate(n: number | undefined): string | null {
  if (typeof n !== "number" || Number.isNaN(n)) return null;
  return `$${n.toFixed(2)}`;
}

/** "$26.00 → $28.00", or a single rate, or em dash. */
function trainingRateLabel(row: StaffOnboarding): string {
  const before = fmtRate(row.trainingRate);
  const after = fmtRate(row.afterTrainingRate);
  if (before && after) return `${before} → ${after}`;
  return before ?? after ?? "—";
}

function fullName(row: StaffOnboarding): string {
  if (row.fullName?.trim()) return row.fullName.trim();
  const f = (row.firstName ?? "").trim();
  const l = (row.lastName ?? "").trim();
  if (f || l) return [f, l].filter(Boolean).join(" ");
  const u = usernameOf(row);
  if (u) return u.charAt(0).toUpperCase() + u.slice(1);
  return row.uid;
}

/** Map raw Firestore position values to display labels. */
function positionLabel(row: StaffOnboarding): string {
  const p = (row.position ?? "").trim().toLowerCase();
  if (p === "hall" || p === "hall_staff" || p === "hall staff") return "Hall Staff";
  if (p === "kitchen" || p === "kitchen_staff" || p === "kitchen staff") return "Kitchen Staff";
  if (row.position?.trim()) return row.position.trim();
  // Fall back to role field
  const role = (row.role ?? "").toLowerCase();
  if (role === "chef") return "Kitchen Staff";
  if (role === "manager") return "Manager";
  if (role && role !== "staff") return role.charAt(0).toUpperCase() + role.slice(1);
  return "Staff";
}

/** Generate 1–2 letter initials from the display name. */
function initialsOf(row: StaffOnboarding): string {
  const name = fullName(row);
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/**
 * Returns the status pill label, or null if no pill should be shown.
 *
 * Statuses that mean "actively working through steps" suppress the pill so
 * the card doesn't show stale/misleading text while the employee is mid-flow.
 *
 * Status values written by the staff-side onboarding pages:
 *   "not_started"   initial state (staff-admin.ts)
 *   "in_progress"   staff is mid-step
 *   "step_complete" a step was saved
 *   "complete"      review-sign finished; awaiting manager approval
 *   "active"        fully approved (filtered out before reaching here)
 */
function pillLabel(row: StaffOnboarding): string | null {
  const raw = (row.status ?? "").trim();
  const s = raw.toLowerCase();

  // Human-readable label set by the manager form (e.g. "Waiting for Documents")
  // Pass through as-is, excluding the technical sentinel values handled below.
  if (
    raw &&
    s !== "not_started" &&
    s !== "active" &&
    s !== "in_progress" &&
    s !== "step_complete" &&
    s !== "complete" &&
    s !== "completed" &&
    s !== "approved"
  ) {
    return raw;
  }

  // Derive from onboarding document-upload progress
  if ((row.completedStep ?? 0) >= TOTAL_STEPS) return "Ready for Approval";

  const hasPassport = !!row.documents?.passportUrl;
  const hasVisa = !!row.documents?.visaUrl;
  const hasRsa = !!row.documents?.rsaUrl;
  const hasTfn = !!row.taxFileNumber;
  const hasBank = !!row.bankSuper?.bsb;

  if (!hasPassport || !hasTfn || !hasBank) return "Waiting for Documents";
  if (!hasVisa || !hasRsa) return "Documents In Review";

  // All documents present but steps not complete
  if (s === "complete" || s === "completed") return "Ready for Approval";

  return "Waiting for Documents";
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

  // Best-effort: register this owner's FCM token so reminders can reach them.
  useEffect(() => {
    if (authLoading || !allowed || !user) return;
    registerFcmToken(user.uid).catch(() => {
      /* silent */
    });
  }, [authLoading, allowed, user]);

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
            fullName: raw.fullName as string | undefined,
            firstName: raw.firstName as string | undefined,
            lastName: raw.lastName as string | undefined,
            preferredName: raw.preferredName as string | undefined,
            username: raw.username as string | undefined,
            email: raw.email as string | undefined,
            role: raw.role as string | undefined,
            position: raw.position as string | undefined,
            status: raw.status as string | undefined,
            startDate: toDate(raw.startDate),
            trainingRate: raw.trainingRate as number | undefined,
            afterTrainingRate: raw.afterTrainingRate as number | undefined,
            trainingPeriod: raw.trainingPeriod as string | undefined,
            completedStep: raw.completedStep as number | undefined,
            step: raw.step as number | undefined,
            documents: raw.documents as StaffOnboarding["documents"],
            taxFileNumber: raw.taxFileNumber as string | undefined,
            bankSuper: raw.bankSuper as StaffOnboarding["bankSuper"],
            createdAt: toDate(raw.createdAt),
          };
        });
        if (cancelled) return;
        // Owners may have a doc here (for FCM tokens) — keep them out of the
        // staff list. Fully-onboarded staff (status === "active") have moved on.
        const staffOnly = data.filter(
          (r) => r.role !== "owner" && r.status !== "active",
        );
        staffOnly.sort((a, b) => {
          const at = a.startDate?.getTime() ?? Infinity;
          const bt = b.startDate?.getTime() ?? Infinity;
          return at - bt;
        });
        setRows(staffOnly);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allowed]);

  const count = useMemo(() => rows?.length ?? 0, [rows]);

  if (authLoading || !allowed) {
    return <Splash />;
  }

  const loading = rows == null;
  const isEmpty = !loading && count === 0;

  return (
    <div className={styles.page}>
      {error && <p className={styles.error}>{error}</p>}

      {loading && <p className={styles.loading}>Loading…</p>}

      {isEmpty && (
        <div className={styles.emptyWrap}>
          <div className={styles.emptyIllustration} aria-hidden="true">
            <Sparkle className={styles.sparkleTopLeft} />
            <Sparkle className={styles.sparkleTopRight} />
            <Sparkle className={styles.sparkleBottomLeft} />
            <span className={styles.emptyCircle}>
              <PersonPlusIcon size={44} />
            </span>
          </div>
          <h2 className={styles.emptyTitle}>No employees currently onboarding</h2>
          <p className={styles.emptySub}>
            New employees will appear here after they have been added.
          </p>
        </div>
      )}

      {!loading && !isEmpty && (
        <>
          {/* Header */}
          <div className={styles.pageHeader}>
            <h1 className={styles.pageTitle}>New Staff Request</h1>
            <p className={styles.pageDesc}>
              New staff added here will be reviewed by the owner
              before activation. Once approved, the new staff will
              be added to the scheduling, and their clock in/out no.
              and Project Y log in ID will be created to begin onboarding.
            </p>
          </div>

          <div className={styles.divider} />

          {/* Section bar */}
          <div className={styles.sectionBar}>
            <span className={styles.sectionBarIcon} aria-hidden="true">
              <PersonPlusIcon size={22} />
            </span>
            <p className={styles.sectionBarLabel}>
              {count} New Staff Request{count === 1 ? "" : "s"}
            </p>
          </div>

          {/* Card list */}
          <ul className={styles.list}>
            {rows!.map((row) => (
              <li key={row.uid}>
                <div className={styles.card}>
                  {/* Top: avatar + name + submitted date */}
                  <div className={styles.cardTop}>
                    <span className={styles.avatar}>{initialsOf(row)}</span>
                    <span className={styles.cardWho}>
                      <span className={styles.name}>{fullName(row)}</span>
                      <span className={styles.position}>{positionLabel(row)}</span>
                    </span>
                    <span className={styles.submittedDate}>
                      Submitted {fmtDate(row.createdAt)}
                    </span>
                    <ChevronIcon />
                  </div>

                  {/* Info row: 4 columns */}
                  <dl className={styles.infoRow}>
                    <div className={styles.infoCell}>
                      <dt className={styles.infoLabel}>START DATE</dt>
                      <dd className={styles.infoValue}>{fmtDate(row.startDate)}</dd>
                    </div>
                    <div className={styles.infoCell}>
                      <dt className={styles.infoLabel}>TRAINING RATE</dt>
                      <dd className={styles.infoValue}>{fmtRate(row.trainingRate) ?? "—"}</dd>
                    </div>
                    <div className={styles.infoCell}>
                      <dt className={styles.infoLabel}>AFTER TRAINING RATE</dt>
                      <dd className={styles.infoValue}>{fmtRate(row.afterTrainingRate) ?? "—"}</dd>
                    </div>
                    <div className={styles.infoCell}>
                      <dt className={styles.infoLabel}>TRAINING PERIOD</dt>
                      <dd className={styles.infoValue}>{row.trainingPeriod ?? "—"}</dd>
                    </div>
                  </dl>

                  {/* View / Edit button */}
                  <div className={styles.cardFooter}>
                    <button
                      type="button"
                      className={styles.viewEditBtn}
                      onClick={() => router.push(`/people/onboarding/${row.uid}`)}
                    >
                      View / Edit
                      <ChevronIcon />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {!loading && (
        <div className={styles.bottomBar}>
          <button
            type="button"
            className={styles.ctaBtn}
            onClick={() => router.push("/people/onboarding/new")}
          >
            <PersonPlusIcon size={20} />
            {isEmpty ? "Add New Employee" : "Add Employee"}
          </button>
        </div>
      )}
    </div>
  );
}

function ChevronIcon() {
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
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

function PersonPlusIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <line x1="16" y1="11" x2="22" y2="11" />
    </svg>
  );
}

function Sparkle({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 0l2.4 9.6L24 12l-9.6 2.4L12 24l-2.4-9.6L0 12l9.6-2.4z" />
    </svg>
  );
}
