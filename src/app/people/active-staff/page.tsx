"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, type Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

type Role = "Staff" | "Manager";
type FilterDept = "All" | "Hall" | "Kitchen" | "Manager";

type StaffDoc = {
  uid: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  role?: string;
  startDate?: Timestamp;
  documents?: {
    visaExpiry?: Timestamp;
  };
};

type Employee = {
  uid: string;
  firstName: string;
  lastName: string;
  role: Role;
  startedAt: Date | null;
  visaExpiry: Date | null;
  isVisaExpiringSoon: boolean;
};

const FILTER_TABS: FilterDept[] = ["All", "Hall", "Kitchen", "Manager"];
const VISA_EXPIRING_WINDOW_DAYS = 60;

/* ── helpers ── */

function tsDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object" && v !== null && "toDate" in (v as object)) {
    try { return (v as Timestamp).toDate(); } catch { return null; }
  }
  return null;
}

function displayName(d: StaffDoc): { firstName: string; lastName: string } {
  const f = (d.firstName ?? "").trim();
  const l = (d.lastName ?? "").trim();
  if (f || l) return { firstName: f, lastName: l };
  const u = (d.username ?? "").trim();
  if (u) return { firstName: u.charAt(0).toUpperCase() + u.slice(1), lastName: "" };
  return { firstName: d.uid.slice(0, 6), lastName: "" };
}

function initials(e: Employee): string {
  const a = (e.firstName.charAt(0) || "?").toUpperCase();
  const b = (e.lastName.charAt(0) || "").toUpperCase();
  return a + b;
}

function fmtStarted(d: Date | null): string {
  if (!d) return "—";
  return `Started ${d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
}

function isExpiringSoon(d: Date | null): boolean {
  if (!d) return false;
  const days = (d.getTime() - Date.now()) / 86400000;
  return days <= VISA_EXPIRING_WINDOW_DAYS && days >= -3;
}

function roleFromDoc(d: StaffDoc): Role {
  return d.role === "manager" ? "Manager" : "Staff";
}

export default function ActiveStaffPage() {
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterDept>("All");

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(getDb(), "staff_onboarding"));
        const list: Employee[] = snap.docs
          .map((dSnap) => {
            const d = { uid: dSnap.id, ...(dSnap.data() as Omit<StaffDoc, "uid">) };
            return d;
          })
          // Owners (tia, yurica, yurina) shouldn't show in the active-staff
          // directory — they're not employees on payroll.
          .filter((d) => d.role !== "owner")
          .map((d) => {
            const { firstName, lastName } = displayName(d);
            const visa = tsDate(d.documents?.visaExpiry);
            return {
              uid: d.uid,
              firstName,
              lastName,
              role: roleFromDoc(d),
              startedAt: tsDate(d.startDate),
              visaExpiry: visa,
              isVisaExpiringSoon: isExpiringSoon(visa),
            };
          });
        // A–Z by first name.
        list.sort((a, b) => a.firstName.localeCompare(b.firstName));
        setEmployees(list);
      } catch {
        /* keep empty */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const stats = useMemo(() => {
    const total = employees.length;
    const visa = employees.filter((e) => e.isVisaExpiringSoon).length;
    // Birthdays / leaving-soon fields aren't stored yet, so they read 0 for now.
    return { total, visa, birthdays: 0, leaving: 0 };
  }, [employees]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return employees.filter((e) => {
      if (filter === "Manager" && e.role !== "Manager") return false;
      // Hall / Kitchen filters need a department field which isn't stored yet —
      // they return empty until that classification lands.
      if (filter === "Hall" || filter === "Kitchen") return false;
      if (!q) return true;
      const full = `${e.firstName} ${e.lastName}`.toLowerCase();
      return full.includes(q) || e.role.toLowerCase().includes(q);
    });
  }, [employees, query, filter]);

  if (loading) return <Splash />;

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
          <p className={styles.statValue}>{stats.total}</p>
          <p className={styles.statLabel}>Active Staff</p>
        </div>
        <div className={styles.statCard}>
          <p className={`${styles.statValue} ${stats.visa > 0 ? styles.statValueWarm : ""}`}>
            {stats.visa}
          </p>
          <p className={styles.statLabel}>Visa Expiring</p>
        </div>
        <div className={styles.statCard}>
          <p className={styles.statValue}>{stats.birthdays}</p>
          <p className={styles.statLabel}>Birthdays<br />This Month</p>
        </div>
        <div className={styles.statCard}>
          <p className={`${styles.statValue} ${stats.leaving > 0 ? styles.statValueWarm : ""}`}>
            {stats.leaving}
          </p>
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

      <p className={styles.countLine}>
        {visible.length} {visible.length === 1 ? "employee" : "employees"}
      </p>

      {/* Employee list */}
      {visible.length === 0 ? (
        <p className={styles.emptyState}>
          {employees.length === 0
            ? "No staff registered yet. Create one from People → Staff +."
            : "No employees match the current filter."}
        </p>
      ) : (
        <ul className={styles.list}>
          {visible.map((e) => (
            <li key={e.uid} className={styles.row}>
              <div className={styles.avatar} aria-hidden="true">{initials(e)}</div>
              <div className={styles.rowBody}>
                <p className={styles.rowName}>{e.firstName} {e.lastName}</p>
                <p className={styles.rowRole}>{e.role}</p>
                <p className={styles.rowSub}>{fmtStarted(e.startedAt)}</p>
              </div>
              <div className={styles.rowStatus}>
                {e.isVisaExpiringSoon ? (
                  <span className={styles.statusVisa}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    Visa Expiring
                  </span>
                ) : (
                  <span className={styles.statusActive}>
                    <span className={styles.dotGreen} aria-hidden="true" />
                    Active
                  </span>
                )}
                <span className={styles.chev} aria-hidden="true">›</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
