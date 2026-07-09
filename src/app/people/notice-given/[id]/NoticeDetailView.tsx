"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  isReadyToTerminate,
  noticeDaysFromToday,
} from "@/lib/notice-last-day";
import styles from "./page.module.css";

export type NoticeDetailData = {
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
  managerNotes: string;
  submittedByName: string;
};

function initials(name: string): string {
  const parts = name.split(" ").filter(Boolean);
  return ((parts[0]?.charAt(0) ?? "?") + (parts[1]?.charAt(0) ?? "")).toUpperCase();
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

function reasonDisplay(n: NoticeDetailData): string {
  if (n.reasonForLeaving === "Other" && n.reasonForLeavingOther.trim()) {
    return `Other — ${n.reasonForLeavingOther.trim()}`;
  }
  return n.reasonForLeaving || "—";
}

function submittedByLine(name: string): string {
  if (!name.trim()) return "Manager";
  return `${name.trim()} (Manager)`;
}

export default function NoticeDetailView({ notice }: { notice: NoticeDetailData }) {
  const router = useRouter();
  const readyToTerminate = isReadyToTerminate(notice.lastWorkingDay);
  const daysLeft = noticeDaysFromToday(notice.lastWorkingDay);

  return (
    <div className={styles.detailPage}>
      <header className={styles.detailHeader}>
        <button
          type="button"
          className={styles.backBtn}
          onClick={() => router.push("/people/notice-given")}
          aria-label="Back"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <div className={styles.detailHeaderMain}>
          <h1 className={styles.detailTitle}>Notice Details</h1>
          <p className={styles.detailSubtitle}>This notice was submitted by the manager.</p>
        </div>
        <button
          type="button"
          className={styles.detailEditBtn}
          onClick={() => router.push(`/people/notice-given/${notice.id}?edit=1`)}
        >
          Edit
        </button>
      </header>

      <section className={styles.detailProfileCard}>
        <div className={styles.detailProfileTop}>
          <div className={styles.detailAvatar}>{initials(notice.employeeName)}</div>
          <div className={styles.detailProfileMain}>
            <p className={styles.detailProfileName}>{notice.employeeName}</p>
            <p className={styles.detailProfilePos}>
              {notice.employeePosition || "Staff"}
              {notice.department !== "Other" && (
                <> • {notice.department}</>
              )}
            </p>
            {notice.department !== "Other" && (
              <span className={styles.detailDeptBadge}>{notice.department}</span>
            )}
          </div>
          <div className={styles.detailProfileStatus}>
            {readyToTerminate ? (
              <span className={styles.detailReadyPill}>
                <span className={styles.detailReadyDot} aria-hidden="true" />
                READY TO TERMINATE
              </span>
            ) : (
              <span className={styles.detailNoticePill}>NOTICE GIVEN</span>
            )}
            {!readyToTerminate && daysLeft !== null && daysLeft >= 0 && (
              <p className={styles.detailDaysLeft}>
                {daysLeft} day{daysLeft === 1 ? "" : "s"} left
              </p>
            )}
            {readyToTerminate && (
              <p className={styles.detailDaysPassed}>Last day passed</p>
            )}
          </div>
        </div>
      </section>

      <p className={styles.detailSectionLabel}>NOTICE INFORMATION</p>
      <section className={styles.detailInfoCard}>
        <InfoRow icon={<CalendarIcon />} label="Notice Given Date" value={fmtWithDay(notice.noticeGivenDate)} />
        <InfoRow icon={<CalendarIcon />} label="Last Working Day" value={fmtWithDay(notice.lastWorkingDay)} accent />
        <InfoRow icon={<DocIcon />} label="Reason for Leaving" value={reasonDisplay(notice)} />
        <InfoRow
          icon={<RehireIcon />}
          label="Rehire Eligible"
          value={notice.rehireEligible || "—"}
          dot={notice.rehireEligible}
        />
        <InfoRow icon={<NoteIcon />} label="Manager Notes" value={notice.managerNotes || "—"} last />
      </section>

      <section className={styles.detailStatusBox}>
        <ClockIcon />
        <div>
          <p className={styles.detailStatusTitle}>
            Current Status: {readyToTerminate ? "Ready to Terminate" : "Notice Given"}
          </p>
          <p className={styles.detailStatusText}>
            The employee remains in Active Employees.
          </p>
        </div>
      </section>

      <p className={styles.detailSectionLabel}>TIMELINE</p>
      <section className={styles.detailTimeline}>
        <TimelineStep
          done
          title="Notice Given"
          sub={`${fmtWithDay(notice.noticeGivenDate)} • By ${submittedByLine(notice.submittedByName)}`}
        />
        <TimelineStep
          done={readyToTerminate}
          title="Last Working Day"
          sub={fmtWithDay(notice.lastWorkingDay)}
        />
        <TimelineStep
          done={false}
          last
          title="Ready to Terminate"
          sub={
            readyToTerminate
              ? "Waiting for owner confirmation"
              : `After ${fmtWithDay(notice.lastWorkingDay)}. Waiting for owner confirmation`
          }
        />
      </section>

      <p className={styles.detailSectionLabel}>RELATED EMPLOYEE</p>
      <button
        type="button"
        className={styles.detailLinkRow}
        onClick={() => router.push(`/people/active/${notice.employeeUid}`)}
      >
        <UserIcon />
        <span>View Employee Profile</span>
        <ChevronIcon />
      </button>

      <section className={styles.detailNextBox}>
        <InfoCircleIcon />
        <div>
          <p className={styles.detailNextTitle}>What happens next?</p>
          <p className={styles.detailNextText}>
            After the last working day, the status will change to Ready to Terminate.
            The employee stays in Active Employees until the owner confirms termination
            from the employee profile.
          </p>
        </div>
      </section>

      <div className={styles.detailBottomBar}>
        <button
          type="button"
          className={styles.detailEditNoticeBtn}
          onClick={() => router.push(`/people/notice-given/${notice.id}?edit=1`)}
        >
          Edit Notice
        </button>
      </div>
    </div>
  );
}

function InfoRow({
  icon,
  label,
  value,
  accent = false,
  dot,
  last = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  accent?: boolean;
  dot?: string;
  last?: boolean;
}) {
  return (
    <div className={`${styles.detailInfoRow} ${last ? styles.detailInfoRowLast : ""}`}>
      <span className={styles.detailInfoIcon} aria-hidden="true">{icon}</span>
      <div className={styles.detailInfoBody}>
        <span className={styles.detailInfoLabel}>{label}</span>
        <span className={`${styles.detailInfoValue} ${accent ? styles.detailInfoAccent : ""}`}>
          {dot && (
            <span
              className={`${styles.detailRehireDot} ${
                dot === "Yes"
                  ? styles.detailRehireDotYes
                  : dot === "No"
                  ? styles.detailRehireDotNo
                  : styles.detailRehireDotUnsure
              }`}
              aria-hidden="true"
            />
          )}
          {value}
        </span>
      </div>
    </div>
  );
}

function TimelineStep({
  done,
  title,
  sub,
  last = false,
}: {
  done: boolean;
  title: string;
  sub: string;
  last?: boolean;
}) {
  return (
    <div className={`${styles.detailTimelineStep} ${last ? styles.detailTimelineStepLast : ""}`}>
      <div className={styles.detailTimelineTrack}>
        <span className={`${styles.detailTimelineDot} ${done ? styles.detailTimelineDotDone : ""}`}>
          {done && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </span>
        {!last && <span className={styles.detailTimelineLine} aria-hidden="true" />}
      </div>
      <div className={styles.detailTimelineContent}>
        <p className={styles.detailTimelineTitle}>{title}</p>
        <p className={styles.detailTimelineSub}>{sub}</p>
      </div>
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function RehireIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function InfoCircleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}
