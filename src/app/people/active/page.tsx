"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  getDocs,
  orderBy,
  query,
  where,
  type Timestamp,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { isOwner, isChef } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

/**
 * Owner-only Active Employees screen. Lists everyone whose onboarding is
 * complete (`status === "active"`), with a stats card, a Needs-Attention
 * summary (visa expiring / birthday / notice given) and a filterable list.
 */

type Staff = {
  uid: string;
  name: string;
  positionKind: "hall" | "kitchen" | "other";
  positionLabel: string;
  rate: number | null;
  visaExpiry: Date | null;
  dob: Date | null;
};

type Notice = {
  id: string;
  employeeUid: string;
  employeeName: string;
  lastWorkingDay: string;
};

type TabKey = "all" | "hall" | "kitchen" | "visa" | "birthday" | "notice";

const VISA_WINDOW_DAYS = 30;
const BIRTHDAY_WINDOW_DAYS = 14;

/* ── Firestore shape ── */

type StoredStaff = {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  preferredName?: string;
  username?: string;
  email?: string;
  role?: string;
  position?: string;
  status?: string;
  dateOfBirth?: string;
  trainingRate?: number;
  afterTrainingRate?: number;
  documents?: { visaExpiry?: Timestamp | string | null };
  visaExpiry?: Timestamp | string | null;
};

type StoredNotice = {
  employeeUid?: string;
  employeeName?: string;
  lastWorkingDay?: string;
};

/* ── Field helpers ── */

function toDate(v: Timestamp | Date | string | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "string") {
    // Anchor date-only ISO strings to midday local time so day-diff math
    // isn't skewed by timezone offsets.
    const [y, m, d] = v.split("-").map(Number);
    if (y && m && d) return new Date(y, m - 1, d, 12);
    const parsed = new Date(v);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof v === "object" && v !== null && "toDate" in v) {
    try {
      return v.toDate();
    } catch {
      return null;
    }
  }
  return null;
}

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

function positionOf(row: StoredStaff): { kind: Staff["positionKind"]; label: string } {
  const p = (row.position ?? "").trim().toLowerCase();
  const role = (row.role ?? "").toLowerCase();
  if (role === "chef" || p.includes("kitchen")) return { kind: "kitchen", label: "Kitchen" };
  if (p.includes("hall") || role === "manager") return { kind: "hall", label: "Hall" };
  if (row.position?.trim()) return { kind: "other", label: row.position.trim() };
  return { kind: "other", label: "Staff" };
}

/** Whole-day difference from today, ignoring hours. Positive = future. */
function daysFromToday(d: Date | null): number | null {
  if (!d) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 86_400_000);
}

/** Days until the NEXT occurrence of a birthday. Handles Feb 29 -> Feb 28. */
function daysUntilBirthday(dob: Date | null): number | null {
  if (!dob) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const month = dob.getMonth();
  const day = dob.getDate();
  let next = new Date(now.getFullYear(), month, day);
  next.setHours(0, 0, 0, 0);
  if (next.getTime() < now.getTime()) {
    next = new Date(now.getFullYear() + 1, month, day);
    next.setHours(0, 0, 0, 0);
  }
  return Math.round((next.getTime() - now.getTime()) / 86_400_000);
}

function fmtDateShort(d: Date | string | null | undefined): string {
  const date = typeof d === "string" ? toDate(d) : d ?? null;
  if (!date) return "—";
  return date.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function fmtRate(n: number | null): string {
  return typeof n === "number" ? `$${n.toFixed(0)}/hr` : "—";
}

export default function ActiveEmployeesPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwner(user) || isChef(user);

  const [staff, setStaff] = useState<Staff[] | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [tab, setTab] = useState<TabKey>("all");

  useEffect(() => {
    if (authLoading) return;
    if (!allowed) router.replace(ROUTES.home);
  }, [allowed, authLoading, router]);

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;

    (async () => {
      try {
        // Only completed onboardings show up here — the onboarding pipeline
        // flips `status` to "active" once the owner approves and the
        // account is created. Everyone else lives on /people/onboarding.
        const staffSnap = await getDocs(
          query(collection(getDb(), "staff_onboarding"), where("status", "==", "active")),
        );
        const rows: Staff[] = staffSnap.docs
          .map((d) => {
            const raw = d.data() as StoredStaff;
            if (raw.role === "owner") return null;
            const { kind, label } = positionOf(raw);
            const rate =
              typeof raw.afterTrainingRate === "number"
                ? raw.afterTrainingRate
                : typeof raw.trainingRate === "number"
                  ? raw.trainingRate
                  : null;
            return {
              uid: d.id,
              name: fullNameOf(raw),
              positionKind: kind,
              positionLabel: label,
              rate,
              visaExpiry: toDate(raw.documents?.visaExpiry ?? raw.visaExpiry ?? null),
              dob: toDate(raw.dateOfBirth ?? null),
            };
          })
          .filter((r): r is Staff => r !== null);

        rows.sort((a, b) => a.name.localeCompare(b.name));

        // Only notices whose last working day hasn't passed. Older entries
        // stay in `notice_given` after the staff move to Terminated.
        const noticeSnap = await getDocs(
          query(collection(getDb(), "notice_given"), orderBy("createdAt", "desc")),
        );
        const todayISO = (() => {
          const d = new Date();
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        })();
        const noticeList: Notice[] = noticeSnap.docs
          .map((d) => {
            const data = d.data() as StoredNotice;
            return {
              id: d.id,
              employeeUid: data.employeeUid ?? "",
              employeeName: data.employeeName ?? "Unknown",
              lastWorkingDay: data.lastWorkingDay ?? "",
            };
          })
          .filter((n) => n.lastWorkingDay >= todayISO);

        if (cancelled) return;
        setStaff(rows);
        setNotices(noticeList);
      } catch {
        if (!cancelled) {
          setStaff([]);
          setNotices([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [allowed]);

  const noticeUids = useMemo(() => new Set(notices.map((n) => n.employeeUid)), [notices]);

  const counts = useMemo(() => {
    const s = staff ?? [];
    return {
      total: s.length,
      hall: s.filter((r) => r.positionKind === "hall").length,
      kitchen: s.filter((r) => r.positionKind === "kitchen").length,
    };
  }, [staff]);

  const attention = useMemo(() => {
    const s = staff ?? [];
    const visaSoon = s
      .map((r) => ({ row: r, days: daysFromToday(r.visaExpiry) }))
      .filter((x): x is { row: Staff; days: number } => x.days !== null && x.days >= 0 && x.days <= VISA_WINDOW_DAYS)
      .sort((a, b) => a.days - b.days);

    const bdaySoon = s
      .map((r) => ({ row: r, days: daysUntilBirthday(r.dob) }))
      .filter((x): x is { row: Staff; days: number } => x.days !== null && x.days >= 0 && x.days <= BIRTHDAY_WINDOW_DAYS)
      .sort((a, b) => a.days - b.days);

    return { visa: visaSoon, birthday: bdaySoon, notice: notices };
  }, [staff, notices]);

  const filtered = useMemo(() => {
    if (!staff) return [];
    let list = staff;
    if (tab === "hall") list = list.filter((r) => r.positionKind === "hall");
    else if (tab === "kitchen") list = list.filter((r) => r.positionKind === "kitchen");
    else if (tab === "visa") {
      const uids = new Set(attention.visa.map((v) => v.row.uid));
      list = list.filter((r) => uids.has(r.uid));
    } else if (tab === "birthday") {
      const uids = new Set(attention.birthday.map((v) => v.row.uid));
      list = list.filter((r) => uids.has(r.uid));
    } else if (tab === "notice") {
      list = list.filter((r) => noticeUids.has(r.uid));
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) list = list.filter((r) => r.name.toLowerCase().includes(q));
    return list;
  }, [staff, tab, searchQuery, attention.visa, attention.birthday, noticeUids]);

  if (authLoading || !allowed) return <Splash />;

  const loading = staff === null;

  return (
    <div className={styles.page}>
      {/* Page header — the shell already provides the hamburger, so the
          page just carries the title. */}
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Active Employees</h1>
      </header>

      {/* Stats card */}
      <section className={styles.statsCard}>
        <div className={styles.statCol}>
          <p className={`${styles.statNumber} ${styles.statNumberAccent}`}>{loading ? "—" : counts.total}</p>
          <p className={styles.statLabel}>Active Staff</p>
          <p className={styles.statSub}>All locations</p>
        </div>
        <div className={styles.statDivider} aria-hidden="true" />
        <div className={styles.statCol}>
          <p className={styles.statNumber}>{loading ? "—" : counts.hall}</p>
          <p className={styles.statLabel}>Hall</p>
        </div>
        <div className={styles.statDivider} aria-hidden="true" />
        <div className={styles.statCol}>
          <p className={styles.statNumber}>{loading ? "—" : counts.kitchen}</p>
          <p className={styles.statLabel}>Kitchen</p>
        </div>
      </section>

      {/* Needs attention */}
      <section className={styles.attentionCard}>
        <div className={styles.attentionHeader}>
          <p className={styles.attentionTitle}>NEEDS ATTENTION</p>
          <button
            type="button"
            className={styles.viewAllLink}
            onClick={() => router.push("/attention-required")}
          >
            View all <span aria-hidden="true">›</span>
          </button>
        </div>
        <div className={styles.attentionGrid}>
          <AttentionColumn
            icon={<TriangleAlertIcon />}
            title="VISA EXPIRING"
            subtitle={`< ${VISA_WINDOW_DAYS} days`}
            items={attention.visa.slice(0, 2).map((x) => ({
              name: x.row.name,
              right: `${x.days} days`,
            }))}
            totalCount={attention.visa.length}
          />
          <AttentionColumn
            icon={<CakeIcon />}
            title="BIRTHDAY COMING UP"
            subtitle={`< ${BIRTHDAY_WINDOW_DAYS} days`}
            items={attention.birthday.slice(0, 2).map((x) => ({
              name: x.row.name,
              right: `${x.days} days`,
            }))}
            totalCount={attention.birthday.length}
          />
          <AttentionColumn
            icon={<NoteIcon />}
            title="NOTICE GIVEN"
            subtitle={" "}
            items={attention.notice.slice(0, 2).map((n) => ({
              name: n.employeeName,
              right: fmtDateShort(n.lastWorkingDay),
            }))}
            totalCount={attention.notice.length}
          />
        </div>
      </section>

      {/* Search + filter */}
      <div className={styles.searchRow}>
        <div className={styles.searchBox}>
          <SearchIcon />
          <input
            type="text"
            placeholder="Search employee"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={styles.searchInput}
            aria-label="Search employees"
          />
        </div>
        <button type="button" className={styles.filterBtn} aria-label="Filter">
          <FilterIcon />
        </button>
      </div>

      {/* Tabs */}
      <div className={styles.tabScroll}>
        <TabButton active={tab === "all"} onClick={() => setTab("all")}>All</TabButton>
        <TabButton active={tab === "hall"} onClick={() => setTab("hall")}>Hall</TabButton>
        <TabButton active={tab === "kitchen"} onClick={() => setTab("kitchen")}>Kitchen</TabButton>
        <TabButton active={tab === "visa"} onClick={() => setTab("visa")}>Visa</TabButton>
        <TabButton active={tab === "birthday"} onClick={() => setTab("birthday")}>Birthday</TabButton>
        <TabButton active={tab === "notice"} onClick={() => setTab("notice")}>Notice Given</TabButton>
      </div>

      {/* Employee list */}
      {loading ? (
        <p className={styles.loading}>Loading…</p>
      ) : filtered.length === 0 ? (
        <p className={styles.empty}>No employees match this filter.</p>
      ) : (
        <ul className={styles.list}>
          {filtered.map((row) => {
            const visaDays = daysFromToday(row.visaExpiry);
            const bdayDays = daysUntilBirthday(row.dob);
            const visaSoon = visaDays !== null && visaDays >= 0 && visaDays <= VISA_WINDOW_DAYS;
            const bdaySoon = bdayDays !== null && bdayDays >= 0 && bdayDays <= BIRTHDAY_WINDOW_DAYS;
            const showBadge = visaSoon || bdaySoon;
            return (
              <li key={row.uid}>
                <button
                  type="button"
                  className={styles.rowBtn}
                  onClick={() => router.push(`/people/active/${row.uid}`)}
                >
                  <span className={styles.rowMain}>
                    <span className={styles.rowName}>{row.name}</span>
                    <span className={styles.rowPos}>{row.positionLabel}</span>
                  </span>
                  <span className={styles.rowRate}>{fmtRate(row.rate)}</span>
                  <span className={styles.rowSide}>
                    {visaSoon ? (
                      <>
                        <span className={styles.sideLabel}>Visa</span>
                        <span className={styles.sideWarm}>{visaDays} days</span>
                        <span className={styles.warnDot} aria-hidden="true">!</span>
                      </>
                    ) : bdaySoon ? (
                      <>
                        <span className={styles.sideLabel}>Birthday</span>
                        <span className={styles.sideWarm}>{bdayDays} days</span>
                        <CakeSmallIcon />
                      </>
                    ) : row.visaExpiry ? (
                      <>
                        <span className={styles.sideLabel}>Visa</span>
                        <span className={styles.sideMuted}>
                          {visaDays !== null ? `${visaDays} days` : "—"}
                        </span>
                      </>
                    ) : null}
                    {!showBadge && <span className={styles.chev} aria-hidden="true">›</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className={styles.footNote}>
        <InfoIcon /> Tap on a staff to view details
      </p>
    </div>
  );
}

/* ── Sub-components ── */

function AttentionColumn({
  icon,
  title,
  subtitle,
  items,
  totalCount,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  items: { name: string; right: string }[];
  totalCount: number;
}) {
  return (
    <div className={styles.attentionCol}>
      <div className={styles.attentionColHeader}>
        <span className={styles.attentionColIcon}>{icon}</span>
        <p className={styles.attentionColTitle}>{title}</p>
        <p className={styles.attentionColSub}>{subtitle}</p>
      </div>
      {items.length === 0 ? (
        <p className={styles.attentionColEmpty}>—</p>
      ) : (
        <ul className={styles.attentionList}>
          {items.map((it) => (
            <li key={it.name} className={styles.attentionItem}>
              <span className={styles.attentionName}>{it.name}</span>
              <span className={styles.attentionRight}>{it.right}</span>
            </li>
          ))}
        </ul>
      )}
      <p className={styles.attentionCount}>
        {totalCount} staff
      </p>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${styles.tab} ${active ? styles.tabActive : ""}`}
    >
      {children}
    </button>
  );
}

/* ── Icons ── */

function TriangleAlertIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function CakeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8" />
      <path d="M4 16s1.5 2 4 2 4-2 4-2 1.5 2 4 2 4-2 4-2" />
      <path d="M2 21h20" />
      <path d="M7 8v3" />
      <path d="M12 8v3" />
      <path d="M17 8v3" />
      <path d="M7 5s.5-1 0-2" />
      <path d="M12 5s.5-1 0-2" />
      <path d="M17 5s.5-1 0-2" />
    </svg>
  );
}

function CakeSmallIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8" />
      <path d="M4 16s1.5 2 4 2 4-2 4-2 1.5 2 4 2 4-2 4-2" />
      <path d="M2 21h20" />
      <path d="M12 8v3" />
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}
