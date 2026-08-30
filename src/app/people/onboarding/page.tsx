"use client";

/**
 * New Employees — everyone hired but not yet signed off.
 *
 * Two tabs, because there are only two things the owner does here. "New" is
 * the people still working through the form, where the only question is who
 * is holding it up; "Ready for Review" is the ones who have finished and are
 * waiting on the owner, where there is a decision to make. Mixing them into
 * one list buried the second kind, which is the half with a deadline — the
 * employee cannot start until someone presses Activate.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, getDocs, type Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { isOwner, isChef, canViewStaffRequest } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import {
  isOnboardingListEmployee,
  onboardingListStatus,
  staffOnboardingFlags,
  type OnboardingListStatus,
} from "@/lib/staff-active";
import { registerFcmToken } from "@/lib/fcm";
import Splash from "@/components/Splash";
import ActivateEmployeeSheet from "@/components/ActivateEmployeeSheet";
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
  createdAt?: Date | null;
  approvedAt?: Date | null;
  updatedAt?: Date | null;
  addedToScheduling?: boolean;
  accountCreated?: boolean;
  requestedByRole?: string;
  requestedByName?: string;
  /** Which half of the list this row sits in, and which pill it wears. */
  listStatus: OnboardingListStatus;
};

type TabKey = "new" | "ready";

/**
 * The pill each state wears — for the two states that wear one.
 *
 * A request nobody has approved and an account nobody has used both go
 * without. Neither is a stage the new hire has reached: one is waiting on the
 * owner and the other on the hire to open the app, and the date line beside
 * them already says which ("Submitted 28 Aug", "Invited 28 Aug"). A pill
 * repeating that word was labelling the absence of progress as progress. The
 * two that remain are both things the hire has actually done: started their
 * form, or finished it.
 */
const STATUS_PILLS: Partial<Record<OnboardingListStatus, string>> = {
  started: "Onboarding Started",
  ready: "Ready for Review",
};

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

/** "$25.50/hr" — the unit is part of the number here, not a column heading. */
function fmtRate(n: number | undefined): string {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  return `$${n.toFixed(2)}/hr`;
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
  const role = (row.role ?? "").toLowerCase();
  if (role === "chef") return "Chef";
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
 * The date line under the pill: when the row last moved, in its own words.
 *
 * A finished form is dated by `updatedAt` — the last step they saved is the
 * moment they completed it — while an unapproved request is dated by when it
 * was submitted. Showing one date labelled two ways would be worse than
 * showing nothing: "Completed 3 Aug" on a row nobody has touched since it was
 * created is a lie the owner would act on. Which is why an unused account
 * reads "Invited" and not "Started": `approvedAt` is when the login was made,
 * not when it was first used, and only the row below it has been.
 */
function dateLine(row: StaffOnboarding): string {
  if (row.listStatus === "ready") return `Completed ${fmtDate(row.updatedAt ?? row.approvedAt)}`;
  if (row.listStatus === "submitted") return `Submitted ${fmtDate(row.createdAt)}`;
  if (row.listStatus === "invited") return `Invited ${fmtDate(row.approvedAt ?? row.createdAt)}`;
  return `Started ${fmtDate(row.approvedAt ?? row.createdAt)}`;
}

/**
 * Where tapping the card goes.
 *
 * Whichever screen has the action that row is waiting on: an unapproved
 * request opens the approval screen, and anyone who has begun the form opens
 * the review of it. The overflow menu offers the other one.
 */
function primaryHref(row: StaffOnboarding): string {
  return row.listStatus === "submitted"
    ? `/people/onboarding/${row.uid}`
    : `/people/onboarding/${row.uid}/review`;
}

export default function ManagerOnboardingPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwner(user) || isChef(user);

  const [rows, setRows] = useState<StaffOnboarding[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("new");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [activating, setActivating] = useState<StaffOnboarding | null>(null);

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
        const data: (StaffOnboarding & { listed: boolean })[] = snap.docs.map((d) => {
          const raw = d.data() as Record<string, unknown>;
          const flags = staffOnboardingFlags(raw);
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
            createdAt: toDate(raw.createdAt),
            approvedAt: toDate(raw.approvedAt),
            updatedAt: toDate(raw.updatedAt),
            addedToScheduling: raw.addedToScheduling as boolean | undefined,
            accountCreated: raw.accountCreated as boolean | undefined,
            requestedByRole: raw.requestedByRole as string | undefined,
            requestedByName: raw.requestedByName as string | undefined,
            listStatus: onboardingListStatus(flags),
            listed: isOnboardingListEmployee(flags),
          };
        });
        if (cancelled) return;
        const visible = data.filter(
          (r) =>
            r.listed &&
            canViewStaffRequest(user, {
              requestedByRole: r.requestedByRole,
              requestedByName: r.requestedByName,
            }),
        );
        visible.sort((a, b) => {
          const at = a.startDate?.getTime() ?? Infinity;
          const bt = b.startDate?.getTime() ?? Infinity;
          return at - bt;
        });
        setRows(visible);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allowed, user]);

  const { total, newRows, readyRows } = useMemo(() => {
    if (!rows) return { total: 0, newRows: [], readyRows: [] };
    return {
      total: rows.length,
      newRows: rows.filter((r) => r.listStatus !== "ready"),
      readyRows: rows.filter((r) => r.listStatus === "ready"),
    };
  }, [rows]);

  const filtered = tab === "ready" ? readyRows : newRows;

  /** Drop an activated row without a refetch — it has left this list. */
  function handleActivated(uid: string) {
    setRows((prev) => (prev ? prev.filter((r) => r.uid !== uid) : prev));
    setActivating(null);
  }

  if (authLoading || !allowed) {
    return <Splash />;
  }

  const loading = rows == null;
  const isEmpty = !loading && total === 0;

  return (
    <div className={styles.page} onClick={() => setMenuFor(null)}>
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
            <h1 className={styles.pageTitle}>New Employees</h1>
            <p className={styles.pageDesc}>
              Everyone hired but not yet activated. They stay here until their
              onboarding has been reviewed and signed off.
            </p>
          </div>

          <div className={styles.divider} />

          {/* Section bar */}
          <div className={styles.sectionBar}>
            <span className={styles.sectionBarIcon} aria-hidden="true">
              <PersonPlusIcon size={20} />
            </span>
            <p className={styles.sectionBarLabel}>
              {total} Request{total === 1 ? "" : "s"}
            </p>
          </div>

          {/* Tabs */}
          <div className={styles.tabBar}>
            <button
              type="button"
              className={`${styles.tab} ${tab === "new" ? styles.tabActive : ""}`}
              onClick={() => setTab("new")}
            >
              New ({newRows.length})
            </button>
            <button
              type="button"
              className={`${styles.tab} ${tab === "ready" ? styles.tabActive : ""}`}
              onClick={() => setTab("ready")}
            >
              Ready for Review ({readyRows.length})
            </button>
          </div>

          {/* Card list */}
          <ul className={styles.list}>
            {filtered.map((row) => {
              const pill = STATUS_PILLS[row.listStatus];
              const ready = row.listStatus === "ready";
              return (
                <li key={row.uid} className={styles.card}>
                  <div
                    role="button"
                    tabIndex={0}
                    className={styles.cardMain}
                    onClick={() => router.push(primaryHref(row))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        router.push(primaryHref(row));
                      }
                    }}
                  >
                    {/* Top: avatar + name + status */}
                    <div className={styles.cardTop}>
                      <span className={styles.avatar} aria-hidden="true">{initialsOf(row)}</span>
                      <span className={styles.cardWho}>
                        <span className={styles.name}>{fullName(row)}</span>
                        <span className={styles.position}>{positionLabel(row)}</span>
                      </span>
                      <span className={styles.cardRight}>
                        {pill && (
                          <span className={`${styles.pill} ${styles.pillWarm}`}>
                            <StatusIcon status={row.listStatus} />
                            {pill}
                          </span>
                        )}
                        <span className={styles.dateSmall}>{dateLine(row)}</span>
                      </span>
                      <button
                        type="button"
                        className={styles.moreBtn}
                        aria-label="More actions"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuFor(menuFor === row.uid ? null : row.uid);
                        }}
                      >
                        <DotsIcon />
                      </button>
                    </div>

                    {/* Info row: 4 columns */}
                    <dl className={styles.infoRow}>
                      <div className={styles.infoCell}>
                        <dt className={styles.infoLabel}>START DATE</dt>
                        <dd className={styles.infoValue}>{fmtDate(row.startDate)}</dd>
                      </div>
                      <div className={styles.infoCell}>
                        <dt className={styles.infoLabel}>TRAINING RATE</dt>
                        <dd className={styles.infoValue}>{fmtRate(row.trainingRate)}</dd>
                      </div>
                      <div className={styles.infoCell}>
                        <dt className={styles.infoLabel}>AFTER TRAINING RATE</dt>
                        <dd className={styles.infoValue}>{fmtRate(row.afterTrainingRate)}</dd>
                      </div>
                      <div className={styles.infoCell}>
                        <dt className={styles.infoLabel}>TRAINING PERIOD</dt>
                        <dd className={styles.infoValue}>{row.trainingPeriod ?? "—"}</dd>
                      </div>
                    </dl>
                  </div>

                  {/* Ready rows carry the verdict itself: read what was sent,
                      or sign it off. Both are the owner's, so they sit on the
                      card rather than a screen further in. */}
                  {ready && (
                    <div className={styles.cardActions}>
                      <button
                        type="button"
                        className={styles.btnOutline}
                        onClick={() => router.push(`/people/onboarding/${row.uid}/review`)}
                      >
                        View Details
                      </button>
                      <button
                        type="button"
                        className={styles.btnPrimary}
                        onClick={() => setActivating(row)}
                      >
                        Activate Employee
                      </button>
                    </div>
                  )}

                  {menuFor === row.uid && (
                    <div className={styles.menu} onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className={styles.menuItem}
                        onClick={() => router.push(`/people/onboarding/${row.uid}`)}
                      >
                        Open Request
                      </button>
                      {row.listStatus !== "submitted" && (
                        <button
                          type="button"
                          className={styles.menuItem}
                          onClick={() => router.push(`/people/onboarding/${row.uid}/review`)}
                        >
                          Review Onboarding
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {/* What happens next, so an empty-looking tab is not read as a
              stuck one. The two tabs are waiting on different people, so
              they say different things. */}
          {filtered.length > 0 && (
            <p className={styles.footerNote}>
              {tab === "ready"
                ? "All required onboarding items have been submitted."
                : "Once onboarding is complete, the request will move to Ready for Review automatically."}
            </p>
          )}

          {filtered.length === 0 && (
            <p className={styles.footerNote}>
              {tab === "ready"
                ? "Nobody is waiting on a review right now."
                : "Everyone here has finished their onboarding."}
            </p>
          )}
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

      {activating && (
        <ActivateEmployeeSheet
          uid={activating.uid}
          name={fullName(activating)}
          positionLabel={positionLabel(activating)}
          startDate={fmtDate(activating.startDate)}
          onClose={() => setActivating(null)}
          onActivated={() => handleActivated(activating.uid)}
        />
      )}
    </div>
  );
}

/* ── Icon components ── */

function StatusIcon({ status }: { status: OnboardingListStatus }) {
  if (status === "ready") {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }
  // Onboarding Started — the form is open and moving.
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
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
