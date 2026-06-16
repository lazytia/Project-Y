"use client";

import { useMemo, useState } from "react";
import styles from "./page.module.css";

/* ──────────────────────────────────────────────────────────────────────
 * Placeholder employee directory. Will be replaced with a Firestore
 * query over staff_onboarding (filtered to active employees) once the
 * employee detail pages and management actions land.
 * ──────────────────────────────────────────────────────────────────── */

type Role = "Hall Staff" | "Kitchen Staff" | "Manager";
type Department = "Hall" | "Kitchen" | "Manager";

type EmployeeStatus =
  | { kind: "active" }
  | { kind: "visaExpiring" }
  | { kind: "leavingSoon"; lastDay: string }; // ISO YYYY-MM-DD

type Employee = {
  id: string;
  firstName: string;
  lastName: string;
  role: Role;
  startedISO: string;
  status: EmployeeStatus;
  // Optional fields used for stat counts.
  birthdayISO?: string; // YYYY-MM-DD (year ignored)
};

const DEPARTMENT_FOR_ROLE: Record<Role, Department> = {
  "Hall Staff": "Hall",
  "Kitchen Staff": "Kitchen",
  "Manager": "Manager",
};

const EMPLOYEES: Employee[] = [
  { id: "ta", firstName: "Tom",  lastName: "Anderson", role: "Hall Staff",    startedISO: "2025-03-15", status: { kind: "active" } },
  { id: "ms", firstName: "Mika", lastName: "Suzuki",   role: "Kitchen Staff", startedISO: "2025-01-10", status: { kind: "visaExpiring" } },
  { id: "sk", firstName: "Sam",  lastName: "Kawano",   role: "Kitchen Staff", startedISO: "2024-12-05", status: { kind: "active" } },
  { id: "lr", firstName: "Lucy", lastName: "Rogers",   role: "Hall Staff",    startedISO: "2024-08-22", status: { kind: "leavingSoon", lastDay: "2025-06-28" } },
  { id: "jd", firstName: "James", lastName: "Davis",   role: "Manager",       startedISO: "2024-02-14", status: { kind: "leavingSoon", lastDay: "2025-07-07" } },
  { id: "hy", firstName: "Hana", lastName: "Yamada",   role: "Kitchen Staff", startedISO: "2025-04-12", status: { kind: "active" }, birthdayISO: "1998-06-18" },
  { id: "bk", firstName: "Ben",  lastName: "Kim",      role: "Hall Staff",    startedISO: "2025-03-01", status: { kind: "active" }, birthdayISO: "1996-06-04" },
];

const TOTAL_ACTIVE_STAFF = 52; // hard-coded headline number until the directory is real

/* ── helpers ── */

function fmtStarted(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `Started ${new Date(y, m - 1, d).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function initials(e: Employee): string {
  return (e.firstName.charAt(0) + e.lastName.charAt(0)).toUpperCase();
}

function isBirthdayThisMonth(iso: string | undefined): boolean {
  if (!iso) return false;
  const m = parseInt(iso.split("-")[1], 10);
  return m === new Date().getMonth() + 1;
}

type FilterDept = "All" | Department;
const FILTER_TABS: FilterDept[] = ["All", "Hall", "Kitchen", "Manager"];

export default function ActiveStaffPage() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterDept>("All");

  const stats = useMemo(() => {
    const visa = EMPLOYEES.filter((e) => e.status.kind === "visaExpiring").length;
    const leaving = EMPLOYEES.filter((e) => e.status.kind === "leavingSoon").length;
    const birthdays = EMPLOYEES.filter((e) => isBirthdayThisMonth(e.birthdayISO)).length;
    return { visa, leaving, birthdays };
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return EMPLOYEES.filter((e) => {
      if (filter !== "All" && DEPARTMENT_FOR_ROLE[e.role] !== filter) return false;
      if (!q) return true;
      const full = `${e.firstName} ${e.lastName}`.toLowerCase();
      return full.includes(q) || e.role.toLowerCase().includes(q);
    });
  }, [query, filter]);

  return (
    <div className={styles.page}>
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <span className={styles.crumbDim}>People</span>
        <span className={styles.crumbSep}>›</span>
        <span className={styles.crumb}>Active Employees</span>
      </nav>

      {/* Stats row */}
      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <p className={styles.statValue}>{TOTAL_ACTIVE_STAFF}</p>
          <p className={styles.statLabel}>Active Staff</p>
        </div>
        <div className={styles.statCard}>
          <p className={`${styles.statValue} ${styles.statValueWarm}`}>{stats.visa}</p>
          <p className={styles.statLabel}>Visa Expiring</p>
        </div>
        <div className={styles.statCard}>
          <p className={styles.statValue}>{stats.birthdays}</p>
          <p className={styles.statLabel}>Birthdays<br />This Month</p>
        </div>
        <div className={styles.statCard}>
          <p className={`${styles.statValue} ${styles.statValueWarm}`}>{stats.leaving}</p>
          <p className={styles.statLabel}>Leaving Soon</p>
        </div>
      </div>

      {/* Search */}
      <div className={styles.searchWrap}>
        <svg className={styles.searchIcon} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search employee…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {/* Filter tabs */}
      <div className={styles.filterRow}>
        <div className={styles.filterTabs}>
          {FILTER_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              className={`${styles.filterTab} ${filter === tab ? styles.filterTabActive : ""}`}
              onClick={() => setFilter(tab)}
            >
              {tab}
            </button>
          ))}
        </div>
        <button type="button" className={styles.filterIcon} aria-label="More filters">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="6" x2="14" y2="6" />
            <line x1="18" y1="6" x2="20" y2="6" />
            <line x1="4" y1="12" x2="10" y2="12" />
            <line x1="14" y1="12" x2="20" y2="12" />
            <line x1="4" y1="18" x2="14" y2="18" />
            <line x1="18" y1="18" x2="20" y2="18" />
            <circle cx="16" cy="6" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="16" cy="18" r="2" />
          </svg>
        </button>
      </div>

      <p className={styles.countLine}>{visible.length} employees</p>

      {/* Employee list */}
      <ul className={styles.list}>
        {visible.map((e) => (
          <li key={e.id} className={styles.row}>
            <div className={styles.avatar} aria-hidden="true">{initials(e)}</div>
            <div className={styles.rowBody}>
              <p className={styles.rowName}>{e.firstName} {e.lastName}</p>
              <p className={styles.rowRole}>{e.role}</p>
              {e.status.kind !== "leavingSoon" && (
                <p className={styles.rowSub}>{fmtStarted(e.startedISO)}</p>
              )}
            </div>
            <div className={styles.rowStatus}>
              {e.status.kind === "active" && (
                <span className={styles.statusActive}>
                  <span className={styles.dotGreen} aria-hidden="true" />
                  Active
                </span>
              )}
              {e.status.kind === "visaExpiring" && (
                <span className={styles.statusVisa}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  Visa Expiring
                </span>
              )}
              {e.status.kind === "leavingSoon" && (
                <div className={styles.statusLeavingWrap}>
                  <span className={styles.statusLeaving}>
                    <span className={styles.dotOrange} aria-hidden="true" />
                    Leaving Soon
                  </span>
                  <span className={styles.lastDay}>
                    Last Day: {fmtDate(e.status.lastDay)}
                  </span>
                </div>
              )}
              <span className={styles.chev} aria-hidden="true">›</span>
            </div>
          </li>
        ))}
        {visible.length === 0 && (
          <li className={styles.empty}>No employees match.</li>
        )}
      </ul>
    </div>
  );
}
