"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  getDocs,
  orderBy,
  query,
  type Timestamp,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { isOwner, isChef, isStrictOwner } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import { noticeLastWorkingDay } from "@/lib/notice-last-day";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

type StoredNotice = {
  employeeUid?: string;
  employeeName?: string;
  employeePosition?: string;
  noticeGivenDate?: string;
  lastWorkingDay?: string;
  reasonForLeaving?: string;
  reasonForLeavingOther?: string;
  rehireEligible?: string;
  finalShiftDate?: string;
  finalShiftTime?: string;
  replacementNeeded?: string;
  managerNotes?: string;
  createdAt?: Timestamp;
};

type Notice = {
  id: string;
  employeeUid: string;
  employeeName: string;
  employeePosition: string;
  department: "Hall" | "Kitchen" | "Other";
  noticeGivenDate: string;
  lastWorkingDay: string;
  reasonForLeaving: string;
  reasonForLeavingOther: string;
  rehireEligible: string;
  finalShiftDate: string;
  finalShiftTime: string;
  replacementNeeded: string;
  managerNotes: string;
  createdAt: Date | null;
};

type ManagerTab = "all" | "this-week" | "next-30" | "overdue";

const MANAGER_TAB_LABELS: Record<ManagerTab, string> = {
  all: "All",
  "this-week": "This Week",
  "next-30": "Next 30 Days",
  overdue: "Overdue",
};

const PER_PAGE_OPTIONS = [10, 20, 50] as const;

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function endOfWeekIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + (7 - d.getDay()));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function next30Iso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function initials(name: string): string {
  const parts = name.split(" ").filter(Boolean);
  return ((parts[0]?.charAt(0) ?? "?") + (parts[1]?.charAt(0) ?? "")).toUpperCase();
}

function fmtShort(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtWithDay(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const main = date.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const day = date.toLocaleDateString("en-AU", { weekday: "short" });
  return `${main} (${day})`;
}

function daysDiff(iso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
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

function departmentOf(position: string): Notice["department"] {
  const p = position.trim().toLowerCase();
  if (p.includes("kitchen") || p.includes("chef")) return "Kitchen";
  if (p.includes("hall") || p.includes("manager")) return "Hall";
  return "Other";
}

function reasonDisplay(n: Notice): string {
  if (n.reasonForLeaving === "Other" && n.reasonForLeavingOther.trim()) {
    return `Other — ${n.reasonForLeavingOther.trim()}`;
  }
  return n.reasonForLeaving || "—";
}

function mapNoticeDoc(id: string, data: StoredNotice): Notice {
  const position = data.employeePosition ?? "";
  return {
    id,
    employeeUid: data.employeeUid ?? "",
    employeeName: data.employeeName ?? "Unknown",
    employeePosition: position,
    department: departmentOf(position),
    noticeGivenDate: data.noticeGivenDate ?? "",
    lastWorkingDay: noticeLastWorkingDay(data),
    reasonForLeaving: data.reasonForLeaving ?? "",
    reasonForLeavingOther: data.reasonForLeavingOther ?? "",
    rehireEligible: data.rehireEligible ?? "",
    finalShiftDate: data.finalShiftDate ?? "",
    finalShiftTime: data.finalShiftTime ?? "",
    replacementNeeded: data.replacementNeeded ?? "",
    managerNotes: data.managerNotes ?? "",
    createdAt: tsDate(data.createdAt),
  };
}

export default function NoticeGivenPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwner(user) || isChef(user);
  const ownerView = isStrictOwner(user);

  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!allowed) {
      router.replace(ROUTES.home);
      return;
    }
    (async () => {
      try {
        const snap = await getDocs(
          query(collection(getDb(), "notice_given"), orderBy("createdAt", "desc")),
        );
        setNotices(snap.docs.map((doc) => mapNoticeDoc(doc.id, doc.data() as StoredNotice)));
      } catch {
        setNotices([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [authLoading, allowed, router]);

  if (authLoading || loading) return <Splash />;
  if (!allowed) return null;

  if (ownerView) {
    return <OwnerNoticeGivenList notices={notices} />;
  }

  return <ManagerNoticeGivenList notices={notices} />;
}

/* ── Owner view (Tia / Yurica) ── */

function OwnerNoticeGivenList({ notices }: { notices: Notice[] }) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<(typeof PER_PAGE_OPTIONS)[number]>(10);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return notices;
    return notices.filter(
      (n) =>
        n.employeeName.toLowerCase().includes(q) ||
        n.employeePosition.toLowerCase().includes(q) ||
        n.department.toLowerCase().includes(q),
    );
  }, [notices, searchQuery]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, perPage]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(page, totalPages);
  const startIdx = total === 0 ? 0 : (safePage - 1) * perPage + 1;
  const endIdx = Math.min(safePage * perPage, total);
  const paged = filtered.slice((safePage - 1) * perPage, safePage * perPage);

  return (
    <div className={styles.ownerPage}>
      <header className={styles.ownerIntro}>
        <h1 className={styles.ownerTitle}>Notice Given</h1>
        <p className={styles.ownerDesc}>
          Notices submitted by managers. Employees remain in Active Employees.
        </p>
      </header>

      <div className={styles.ownerSearchRow}>
        <div className={styles.ownerSearchBox}>
          <SearchIcon />
          <input
            type="text"
            placeholder="Search by name, department, or position"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={styles.ownerSearchInput}
            aria-label="Search notices"
          />
        </div>
        <button type="button" className={styles.ownerFilterBtn} aria-label="Filter">
          <FilterIcon />
        </button>
      </div>

      <div className={styles.ownerTabs}>
        <span className={`${styles.ownerTab} ${styles.ownerTabActive}`}>
          All Notices {notices.length}
        </span>
      </div>

      {paged.length === 0 ? (
        <p className={styles.ownerEmpty}>No notices found.</p>
      ) : (
        <ul className={styles.ownerList}>
          {paged.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className={styles.ownerCard}
                onClick={() => {
                  if (n.employeeUid) router.push(`/people/active/${n.employeeUid}`);
                }}
              >
                <div className={styles.ownerCardTop}>
                  <div className={styles.ownerAvatar}>{initials(n.employeeName)}</div>
                  <div className={styles.ownerCardMain}>
                    <div className={styles.ownerCardIdentity}>
                      <p className={styles.ownerCardName}>{n.employeeName}</p>
                      <p className={styles.ownerCardPos}>{n.employeePosition || "—"}</p>
                      {n.department !== "Other" && (
                        <span className={styles.ownerDeptBadge}>{n.department}</span>
                      )}
                    </div>
                    <div className={styles.ownerCardDates}>
                      <div className={styles.ownerDateBlock}>
                        <span className={styles.ownerDateLabel}>Notice Given</span>
                        <span className={styles.ownerDateValue}>{fmtWithDay(n.noticeGivenDate)}</span>
                      </div>
                      <div className={styles.ownerDateBlock}>
                        <span className={styles.ownerDateLabel}>Last Working Day</span>
                        <span className={`${styles.ownerDateValue} ${styles.ownerDateWarm}`}>
                          {fmtWithDay(n.lastWorkingDay)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <ChevronIcon />
                </div>
                <div className={styles.ownerCardFooter}>
                  <span className={styles.ownerFooterItem}>
                    <span className={styles.ownerFooterLabel}>Reason</span>
                    <span className={styles.ownerFooterValue}>{reasonDisplay(n)}</span>
                  </span>
                  <span className={styles.ownerFooterItem}>
                    <span className={styles.ownerFooterLabel}>Rehire Eligible</span>
                    <span className={styles.ownerRehireValue}>
                      <RehireDot value={n.rehireEligible} />
                      {n.rehireEligible || "—"}
                    </span>
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {total > 0 && (
        <div className={styles.ownerPagination}>
          <p className={styles.ownerPaginationText}>
            Showing {startIdx} to {endIdx} of {total} notices
          </p>
          <div className={styles.ownerPaginationControls}>
            <button
              type="button"
              className={styles.ownerPageBtn}
              aria-current="page"
            >
              {safePage}
            </button>
            <select
              className={styles.ownerPerPage}
              value={perPage}
              onChange={(e) => setPerPage(Number(e.target.value) as (typeof PER_PAGE_OPTIONS)[number])}
              aria-label="Notices per page"
            >
              {PER_PAGE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} per page
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <aside className={styles.ownerInfoBox}>
        <InfoIcon />
        <p className={styles.ownerInfoText}>
          These are notice records created by managers. Employees remain in Active Employees
          and their status updates by the owner.
        </p>
      </aside>
    </div>
  );
}

function RehireDot({ value }: { value: string }) {
  const kind =
    value === "Yes" ? styles.rehireDotYes : value === "No" ? styles.rehireDotNo : styles.rehireDotUnsure;
  return <span className={`${styles.rehireDot} ${kind}`} aria-hidden="true" />;
}

/* ── Manager view (Yurina / chef) ── */

function ManagerNoticeGivenList({ notices }: { notices: Notice[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<ManagerTab>("all");
  const [today, setToday] = useState("");
  const [endWeek, setEndWeek] = useState("");
  const [next30, setNext30] = useState("");

  useEffect(() => {
    setToday(todayIso());
    setEndWeek(endOfWeekIso());
    setNext30(next30Iso());
  }, []);

  const filtered = useMemo(() => {
    switch (tab) {
      case "this-week":
        return notices.filter((n) => n.lastWorkingDay >= today && n.lastWorkingDay <= endWeek);
      case "next-30":
        return notices.filter((n) => n.lastWorkingDay >= today && n.lastWorkingDay <= next30);
      case "overdue":
        return notices.filter((n) => n.lastWorkingDay < today);
      default:
        return notices;
    }
  }, [notices, tab, today, endWeek, next30]);

  const counts = useMemo(
    () => ({
      all: notices.length,
      "this-week": notices.filter((n) => n.lastWorkingDay >= today && n.lastWorkingDay <= endWeek).length,
      "next-30": notices.filter((n) => n.lastWorkingDay >= today && n.lastWorkingDay <= next30).length,
      overdue: notices.filter((n) => n.lastWorkingDay < today).length,
    }),
    [notices, today, endWeek, next30],
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.headerSpacer} />
        <h1 className={styles.title}>Notice Given</h1>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => router.push("/people/notice-given/new")}
          aria-label="Add notice given"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </header>

      <div className={styles.infoBox}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.infoIcon}>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <p className={styles.infoText}>
          Employees who have given notice to leave. They will move to{" "}
          <span className={styles.infoWarm}>Terminated</span> after their last working day.
        </p>
      </div>

      <div className={styles.tabs}>
        {(["all", "this-week", "next-30", "overdue"] as ManagerTab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={`${styles.tab} ${tab === t ? styles.tabActive : ""}`}
            onClick={() => setTab(t)}
          >
            {MANAGER_TAB_LABELS[t]} ({counts[t]})
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className={styles.empty}>No notices found in this category.</p>
      ) : (
        <ul className={styles.list}>
          {filtered.map((n) => {
            const diff = n.lastWorkingDay ? daysDiff(n.lastWorkingDay) : null;
            const isOverdue = diff !== null && diff < 0;
            return (
              <li key={n.id}>
                <button type="button" className={styles.card} onClick={() => router.push(`/people/notice-given/${n.id}`)}>
                  <div className={styles.cardTop}>
                    <div className={styles.avatar}>{initials(n.employeeName)}</div>
                    <div className={styles.cardBody}>
                      <div className={styles.cardNameRow}>
                        <p className={styles.cardName}>{n.employeeName}</p>
                        <span className={`${styles.badge} ${isOverdue ? styles.badgeOverdue : styles.badgeUpcoming}`}>
                          {isOverdue ? "Overdue" : "Upcoming"}
                        </span>
                      </div>
                      <p className={styles.cardPos}>{n.employeePosition}</p>
                      {diff !== null && (
                        <p className={styles.cardCountdown}>
                          {diff === 0
                            ? "Last day is today"
                            : diff > 0
                            ? `Last day in ${diff} day${diff === 1 ? "" : "s"}`
                            : `Last day was ${Math.abs(diff)} day${Math.abs(diff) === 1 ? "" : "s"} ago`}
                        </p>
                      )}
                    </div>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={styles.chev}>
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </div>

                  <dl className={styles.cardMeta}>
                    {n.noticeGivenDate && (
                      <div className={styles.metaItem}>
                        <dt className={styles.metaLabel}>Notice Given</dt>
                        <dd className={styles.metaValue}>{fmtShort(n.noticeGivenDate)}</dd>
                      </div>
                    )}
                    {n.lastWorkingDay && (
                      <div className={styles.metaItem}>
                        <dt className={styles.metaLabel}>Last Working Day</dt>
                        <dd className={`${styles.metaValue} ${styles.metaValueWarm}`}>{fmtShort(n.lastWorkingDay)}</dd>
                      </div>
                    )}
                    {n.reasonForLeaving && (
                      <div className={styles.metaItem}>
                        <dt className={styles.metaLabel}>Reason</dt>
                        <dd className={styles.metaValue}>{reasonDisplay(n)}</dd>
                      </div>
                    )}
                  </dl>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className={styles.bottomBar}>
        <button
          type="button"
          className={styles.ctaBtn}
          onClick={() => router.push("/people/notice-given/new")}
        >
          + Add Notice Given
        </button>
      </div>
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

function ChevronIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={styles.ownerChev} aria-hidden="true">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.ownerInfoIcon} aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}
