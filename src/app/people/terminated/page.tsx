"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, getDocs, type Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { isOwner, isChef } from "@/lib/permissions";
import { emailToUsername } from "@/lib/username";
import { ROUTES } from "@/lib/routes";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

type StoredStaff = {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  email?: string;
  role?: string;
  position?: string;
  status?: string;
  lastWorkingDate?: string;
  terminatedAt?: Timestamp | null;
  terminationReason?: string;
  reasonForLeaving?: string;
  reasonForLeavingOther?: string;
};

type TerminatedEmployee = {
  uid: string;
  name: string;
  positionTitle: string;
  department: "Hall" | "Kitchen" | "Other";
  departmentKind: "hall" | "kitchen" | "other";
  lastWorkingDay: string;
  reason: string;
  terminatedAt: Date | null;
};

type DeptFilter = "all" | "hall" | "kitchen";
type PositionFilter = "all" | string;
type SortDir = "desc" | "asc";

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

function usernameFrom(row: StoredStaff): string {
  if (row.username) return row.username;
  const email = row.email ?? "";
  const at = email.indexOf("@");
  return at === -1 ? email : email.slice(0, at);
}

function fullNameOf(row: StoredStaff): string {
  if (row.fullName?.trim()) return row.fullName.trim();
  const f = (row.firstName ?? "").trim();
  const l = (row.lastName ?? "").trim();
  if (f || l) return [f, l].filter(Boolean).join(" ");
  const u = usernameFrom(row);
  return u ? u.charAt(0).toUpperCase() + u.slice(1) : "Unknown";
}

function departmentOf(row: StoredStaff): {
  kind: TerminatedEmployee["departmentKind"];
  label: TerminatedEmployee["department"];
} {
  const p = (row.position ?? "").trim().toLowerCase();
  const role = (row.role ?? "").toLowerCase();
  if (role === "chef" || p.includes("kitchen")) return { kind: "kitchen", label: "Kitchen" };
  if (p.includes("hall") || role === "manager") return { kind: "hall", label: "Hall" };
  return { kind: "other", label: "Other" };
}

function positionTitleOf(row: StoredStaff): string {
  const custom = (row.position ?? "").trim();
  if (custom) return custom;
  const { kind } = departmentOf(row);
  if (kind === "hall") return "Hall Staff";
  if (kind === "kitchen") return "Kitchen Staff";
  return "Staff";
}

function tsDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object" && v !== null && "toDate" in (v as object)) {
    try {
      return (v as Timestamp).toDate();
    } catch {
      return null;
    }
  }
  return null;
}

function reasonOf(row: StoredStaff): string {
  if (row.terminationReason?.trim()) return row.terminationReason.trim();
  const base = row.reasonForLeaving ?? "";
  if (!base) return "—";
  if (base === "Other" && row.reasonForLeavingOther?.trim()) {
    return `Other — ${row.reasonForLeavingOther.trim()}`;
  }
  return base;
}

function initials(name: string): string {
  const parts = name.split(" ").filter(Boolean);
  return ((parts[0]?.charAt(0) ?? "?") + (parts[1]?.charAt(0) ?? "")).toUpperCase();
}

function fmtLastDay(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "—";
  const date = new Date(y, m - 1, d);
  const main = date.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const day = date.toLocaleDateString("en-AU", { weekday: "short" });
  return `${main} (${day})`;
}

function isoFromDate(d: Date | null): string {
  if (!d) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function referenceIso(row: TerminatedEmployee): string {
  return row.lastWorkingDay || isoFromDate(row.terminatedAt);
}

function isSameYear(iso: string, year: number): boolean {
  if (!iso) return false;
  return Number(iso.slice(0, 4)) === year;
}

function isSameMonth(iso: string, year: number, month: number): boolean {
  if (!iso) return false;
  const [y, m] = iso.split("-").map(Number);
  return y === year && m === month + 1;
}

function isSameQuarter(iso: string, year: number, quarter: number): boolean {
  if (!iso) return false;
  const [y, m] = iso.split("-").map(Number);
  if (y !== year) return false;
  const q = Math.floor((m - 1) / 3);
  return q === quarter;
}

function quarterLabel(now: Date): string {
  const q = Math.floor(now.getMonth() / 3);
  const start = q * 3;
  const end = start + 2;
  return `${MONTHS_SHORT[start]} - ${MONTHS_SHORT[end]} ${now.getFullYear()}`;
}

function monthLabel(now: Date): string {
  return `${MONTHS_SHORT[now.getMonth()]} ${now.getFullYear()}`;
}

export default function TerminatedEmployeesPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwner(user) || isChef(user);

  const [employees, setEmployees] = useState<TerminatedEmployee[] | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [deptFilter, setDeptFilter] = useState<DeptFilter>("all");
  const [positionFilter, setPositionFilter] = useState<PositionFilter>("all");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const now = useMemo(() => new Date(), []);

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
        const rows: TerminatedEmployee[] = snap.docs
          .map((d) => {
            const raw = d.data() as StoredStaff;
            if ((raw.status ?? "").toLowerCase() !== "terminated") return null;
            const dept = departmentOf(raw);
            const lastDay = raw.lastWorkingDate ?? "";
            return {
              uid: d.id,
              name: fullNameOf(raw),
              positionTitle: positionTitleOf(raw),
              department: dept.label,
              departmentKind: dept.kind,
              lastWorkingDay: lastDay,
              reason: reasonOf(raw),
              terminatedAt: tsDate(raw.terminatedAt),
            };
          })
          .filter((r): r is TerminatedEmployee => r !== null);

        if (!cancelled) setEmployees(rows);
      } catch {
        if (!cancelled) setEmployees([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [allowed]);

  const positionOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of employees ?? []) set.add(e.positionTitle);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [employees]);

  const stats = useMemo(() => {
    const list = employees ?? [];
    const year = now.getFullYear();
    const month = now.getMonth();
    const quarter = Math.floor(month / 3);
    return {
      total: list.length,
      year: list.filter((e) => isSameYear(referenceIso(e), year)).length,
      quarter: list.filter((e) => isSameQuarter(referenceIso(e), year, quarter)).length,
      month: list.filter((e) => isSameMonth(referenceIso(e), year, month)).length,
      yearLabel: String(year),
      quarterLabel: quarterLabel(now),
      monthLabel: monthLabel(now),
    };
  }, [employees, now]);

  const filtered = useMemo(() => {
    let list = employees ?? [];
    if (deptFilter === "hall") list = list.filter((e) => e.departmentKind === "hall");
    else if (deptFilter === "kitchen") list = list.filter((e) => e.departmentKind === "kitchen");

    if (positionFilter !== "all") {
      list = list.filter((e) => e.positionTitle === positionFilter);
    }

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.department.toLowerCase().includes(q) ||
          e.positionTitle.toLowerCase().includes(q),
      );
    }

    list = [...list].sort((a, b) => {
      const aIso = referenceIso(a) || "0000-00-00";
      const bIso = referenceIso(b) || "0000-00-00";
      const cmp = bIso.localeCompare(aIso);
      return sortDir === "desc" ? cmp : -cmp;
    });

    return list;
  }, [employees, deptFilter, positionFilter, searchQuery, sortDir]);

  if (authLoading || !allowed) return <Splash />;

  const loading = employees === null;

  return (
    <div className={styles.page}>
      <header className={styles.intro}>
        <h1 className={styles.pageTitle}>Terminated Employees</h1>
        <p className={styles.pageDesc}>
          These employees have been terminated. All records and documents are securely
          archived and can be viewed at any time.
        </p>
      </header>

      <section className={styles.statsScroll} aria-label="Termination statistics">
        <div className={styles.statCard}>
          <p className={`${styles.statNumber} ${styles.statNumberAccent}`}>
            {loading ? "—" : stats.total}
          </p>
          <p className={styles.statLabel}>Total Terminated</p>
          <p className={styles.statSub}>All locations</p>
        </div>
        <div className={styles.statCard}>
          <p className={styles.statNumber}>{loading ? "—" : stats.year}</p>
          <p className={styles.statLabel}>This Year</p>
          <p className={styles.statSub}>{stats.yearLabel}</p>
        </div>
        <div className={styles.statCard}>
          <p className={styles.statNumber}>{loading ? "—" : stats.quarter}</p>
          <p className={styles.statLabel}>This Quarter</p>
          <p className={styles.statSub}>{stats.quarterLabel}</p>
        </div>
        <div className={styles.statCard}>
          <p className={styles.statNumber}>{loading ? "—" : stats.month}</p>
          <p className={styles.statLabel}>This Month</p>
          <p className={styles.statSub}>{stats.monthLabel}</p>
        </div>
      </section>

      <div className={styles.searchRow}>
        <div className={styles.searchBox}>
          <SearchIcon />
          <input
            type="text"
            placeholder="Search by name, department or position"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={styles.searchInput}
            aria-label="Search terminated employees"
          />
        </div>
        <button type="button" className={styles.filterBtn} aria-label="Filter">
          <FilterIcon />
        </button>
      </div>

      <div className={styles.filterRow}>
        <select className={styles.filterSelect} defaultValue="all" aria-label="Location">
          <option value="all">All Locations</option>
        </select>
        <select
          className={styles.filterSelect}
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value as DeptFilter)}
          aria-label="Department"
        >
          <option value="all">All Departments</option>
          <option value="hall">Hall</option>
          <option value="kitchen">Kitchen</option>
        </select>
        <select
          className={styles.filterSelect}
          value={positionFilter}
          onChange={(e) => setPositionFilter(e.target.value)}
          aria-label="Position"
        >
          <option value="all">All Positions</option>
          {positionOptions.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.sortBar}>
        <button
          type="button"
          className={styles.sortBtn}
          onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
        >
          <CalendarIcon />
          <span>Last Working Day</span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`${styles.sortArrow} ${sortDir === "asc" ? styles.sortArrowAsc : ""}`}
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      {loading ? (
        <p className={styles.empty}>Loading…</p>
      ) : filtered.length === 0 ? (
        <p className={styles.empty}>No terminated employees found.</p>
      ) : (
        <ul className={styles.list}>
          {filtered.map((e) => (
            <li key={e.uid}>
              <button
                type="button"
                className={styles.card}
                onClick={() => router.push(`/people/active/${e.uid}`)}
              >
                <div className={styles.avatar}>{initials(e.name)}</div>
                <div className={styles.cardMain}>
                  <div className={styles.cardIdentity}>
                    <p className={styles.cardName}>{e.name}</p>
                    <p className={styles.cardPos}>{e.positionTitle}</p>
                    {e.department !== "Other" && (
                      <span className={styles.deptBadge}>{e.department}</span>
                    )}
                  </div>
                  <div className={styles.cardDetails}>
                    <div className={styles.detailBlock}>
                      <span className={styles.detailLabel}>Last Working Day</span>
                      <span className={styles.detailValue}>{fmtLastDay(e.lastWorkingDay)}</span>
                    </div>
                    <div className={styles.detailBlock}>
                      <span className={styles.detailLabel}>Reason</span>
                      <span className={styles.detailValue}>{e.reason}</span>
                    </div>
                  </div>
                </div>
                <ChevronIcon />
              </button>
            </li>
          ))}
        </ul>
      )}

      <aside className={styles.archiveBox}>
        <LockIcon />
        <p className={styles.archiveText}>
          All employee data, documents, and HR notes are permanently archived. You can
          view but cannot edit terminated employee records.
        </p>
        <ChevronIcon />
      </aside>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="7" y1="12" x2="17" y2="12" />
      <line x1="10" y1="18" x2="14" y2="18" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.sortIcon} aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={styles.chev} aria-hidden="true">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.archiveIcon} aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
