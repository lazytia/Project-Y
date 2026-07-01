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
import { isOwner, isChef } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
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

type Tab = "all" | "this-week" | "next-30" | "overdue";

const TAB_LABELS: Record<Tab, string> = {
  all: "All",
  "this-week": "This Week",
  "next-30": "Next 30 Days",
  overdue: "Overdue",
};

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
    try { return (v as Timestamp).toDate(); } catch { return null; }
  }
  return null;
}

export default function NoticeGivenPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwner(user) || isChef(user);

  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("all");

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
        const list: Notice[] = snap.docs.map((doc) => {
          const data = doc.data() as StoredNotice;
          return {
            id: doc.id,
            employeeUid: data.employeeUid ?? "",
            employeeName: data.employeeName ?? "Unknown",
            employeePosition: data.employeePosition ?? "",
            noticeGivenDate: data.noticeGivenDate ?? "",
            lastWorkingDay: data.lastWorkingDay ?? "",
            reasonForLeaving: data.reasonForLeaving ?? "",
            reasonForLeavingOther: data.reasonForLeavingOther ?? "",
            rehireEligible: data.rehireEligible ?? "",
            finalShiftDate: data.finalShiftDate ?? "",
            finalShiftTime: data.finalShiftTime ?? "",
            replacementNeeded: data.replacementNeeded ?? "",
            managerNotes: data.managerNotes ?? "",
            createdAt: tsDate(data.createdAt),
          };
        });
        setNotices(list);
      } catch {
        /* keep empty */
      } finally {
        setLoading(false);
      }
    })();
  }, [authLoading, allowed, router]);

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

  if (authLoading || loading) return <Splash />;
  if (!allowed) return null;

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

      {/* Info banner */}
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

      {/* Tabs */}
      <div className={styles.tabs}>
        {(["all", "this-week", "next-30", "overdue"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={`${styles.tab} ${tab === t ? styles.tabActive : ""}`}
            onClick={() => setTab(t)}
          >
            {TAB_LABELS[t]} ({counts[t]})
          </button>
        ))}
      </div>

      {/* Employee list */}
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
                        <dd className={styles.metaValue}>
                          {n.reasonForLeaving === "Other" && n.reasonForLeavingOther
                            ? `Other — ${n.reasonForLeavingOther}`
                            : n.reasonForLeaving}
                        </dd>
                      </div>
                    )}
                  </dl>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Fixed bottom CTA */}
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
