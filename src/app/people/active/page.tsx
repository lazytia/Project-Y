"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { type Timestamp } from "firebase/firestore";
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

/**
 * Placeholder roster used while the real staff_onboarding docs aren't
 * seeded yet. Dates are relative to `today` at page-load so the visa /
 * birthday chips animate correctly no matter when the demo is opened.
 */
function buildMockStaff(): Staff[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const inDays = (n: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + n);
    return d;
  };
  const birthdayInDays = (n: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + n);
    // Anchor to 1998 so the DOB looks plausible rather than the current year.
    d.setFullYear(1998);
    return d;
  };
  return [
    { uid: "m1", name: "Hiyori Nozawa", positionKind: "hall", positionLabel: "Hall", rate: 30, visaExpiry: inDays(18), dob: birthdayInDays(120) },
    { uid: "m2", name: "Lucy Chen", positionKind: "hall", positionLabel: "Hall", rate: 28, visaExpiry: inDays(12), dob: birthdayInDays(200) },
    { uid: "m3", name: "Suti Kawano", positionKind: "kitchen", positionLabel: "Kitchen", rate: 33, visaExpiry: inDays(92), dob: birthdayInDays(9) },
    { uid: "m4", name: "James Min", positionKind: "kitchen", positionLabel: "Kitchen", rate: 32, visaExpiry: inDays(320), dob: birthdayInDays(5) },
    { uid: "m5", name: "Yuki Tanaka", positionKind: "hall", positionLabel: "Hall", rate: 26, visaExpiry: inDays(1537), dob: birthdayInDays(180) },
    { uid: "m6", name: "Timothy Yang", positionKind: "kitchen", positionLabel: "Kitchen", rate: 30, visaExpiry: inDays(1461), dob: birthdayInDays(60) },
    { uid: "m7", name: "Chiaki Sato", positionKind: "hall", positionLabel: "Hall", rate: 29, visaExpiry: inDays(410), dob: birthdayInDays(150) },
    { uid: "m8", name: "Jared Kim", positionKind: "kitchen", positionLabel: "Kitchen", rate: 34, visaExpiry: inDays(650), dob: birthdayInDays(90) },
    { uid: "m9", name: "Aoi Yamamoto", positionKind: "hall", positionLabel: "Hall", rate: 27, visaExpiry: inDays(240), dob: birthdayInDays(45) },
    { uid: "m10", name: "Ryo Fujita", positionKind: "hall", positionLabel: "Hall", rate: 28, visaExpiry: inDays(800), dob: birthdayInDays(300) },
  ];
}

function buildMockNotices(): Notice[] {
  const today = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const inDaysISO = (n: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + n);
    return iso(d);
  };
  return [
    { id: "n1", employeeUid: "m7", employeeName: "Chiaki Sato", lastWorkingDay: inDaysISO(12) },
    { id: "n2", employeeUid: "m8", employeeName: "Jared Kim", lastWorkingDay: inDaysISO(22) },
  ];
}

/* ── Field helpers ── */

function toDate(v: unknown): Date | null {
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
  if (typeof v === "object" && v !== null && "toDate" in (v as object)) {
    try {
      return (v as Timestamp).toDate();
    } catch {
      return null;
    }
  }
  return null;
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
    // Real Firestore queries land here once staff_onboarding is seeded;
    // for now render a fixed roster so the screen is demo-able.
    setStaff(buildMockStaff());
    setNotices(buildMockNotices());
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
                  onClick={() => router.push(`/people/onboarding/${row.uid}`)}
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
        <div>
          <p className={styles.attentionColTitle}>{title}</p>
          <p className={styles.attentionColSub}>{subtitle}</p>
        </div>
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
