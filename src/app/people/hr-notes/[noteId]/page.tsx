"use client";

import { use } from "react";
import { useRouter, notFound } from "next/navigation";
import styles from "./page.module.css";

/* ──────────────────────────────────────────────────────────────────────
 * HR Note Details — read-only view of a saved note.
 *
 * Notes are still placeholder until the Add HR Note step 2 form writes
 * to Firestore. Look the note up by id from the in-memory list that
 * powers the Timeline view.
 * ──────────────────────────────────────────────────────────────────── */

type NoteKind = "Formal Warning" | "Performance Review" | "Incident Report" | "Other";

type Note = {
  id: string;
  employeeName: string;
  employeeRole: "Hall Staff" | "Kitchen Staff" | "Manager";
  kind: NoteKind;
  summary: string;
  details: string;
  actionTaken: string;
  addedBy: string;
  createdAtISO: string;
  checkboxes: { label: string; checked: boolean }[];
};

const NOTES: Note[] = [
  {
    id: "n1",
    employeeName: "Yuki Tanaka",
    employeeRole: "Kitchen Staff",
    kind: "Formal Warning",
    summary: "Repeated late arrival without prior notice.",
    details: "Yuki arrived 25 minutes late on 12 Jun 2026 without prior notice.",
    actionTaken: "Discussed attendance expectations and store policy. A formal warning was issued and Yuki was advised that further violations may result in disciplinary action.",
    addedBy: "You (Store Manager)",
    createdAtISO: "2026-06-12T10:15:00+10:00",
    checkboxes: [
      { label: "Discussed with employee",            checked: true },
      { label: "Employee given opportunity to respond", checked: true },
    ],
  },
  {
    id: "n2",
    employeeName: "Sam Lee",
    employeeRole: "Hall Staff",
    kind: "Performance Review",
    summary: "Quarterly review completed.",
    details: "Strong customer-service skills, consistent attendance, takes initiative during peak service hours.",
    actionTaken: "Performance reviewed for Q2 2026. Goals for next quarter agreed: complete barista training and lead morning briefings twice a week.",
    addedBy: "You (Store Manager)",
    createdAtISO: "2026-06-03T14:30:00+10:00",
    checkboxes: [
      { label: "Goals discussed with employee",         checked: true },
      { label: "Employee given opportunity to respond", checked: true },
    ],
  },
  {
    id: "n3",
    employeeName: "Kenji Watanabe",
    employeeRole: "Hall Staff",
    kind: "Incident Report",
    summary: "Customer complaint regarding service.",
    details: "At 7:42 PM on 10 Apr 2026 a guest complained about being seated late and the food order being incorrect.",
    actionTaken: "Apologised to guest, offered a complimentary dessert. Coached Kenji on prioritising order accuracy under pressure.",
    addedBy: "Store Manager",
    createdAtISO: "2026-04-10T09:45:00+10:00",
    checkboxes: [
      { label: "Reported to management",          checked: true },
      { label: "Witnesses noted in the record", checked: true },
    ],
  },
  {
    id: "n4",
    employeeName: "Mei Chen",
    employeeRole: "Kitchen Staff",
    kind: "Formal Warning",
    summary: "Policy violation: Unauthorised absence.",
    details: "Mei did not attend their scheduled shift on 01 Mar 2026 and did not notify management.",
    actionTaken: "Formal warning issued. Reminded Mei of leave-request policy. Further unexcused absences may result in disciplinary action.",
    addedBy: "You (Store Manager)",
    createdAtISO: "2026-03-01T11:00:00+10:00",
    checkboxes: [
      { label: "Discussed with employee",            checked: true },
      { label: "Employee given opportunity to respond", checked: true },
    ],
  },
  {
    id: "n5",
    employeeName: "Taro Honda",
    employeeRole: "Hall Staff",
    kind: "Other",
    summary: "Discussed availability change request.",
    details: "Taro requested to change Tuesday availability to start at 5 PM instead of 11 AM due to a new university class.",
    actionTaken: "Acknowledged request and will assess roster impact before approving from the next published roster.",
    addedBy: "You (Store Manager)",
    createdAtISO: "2026-02-14T15:20:00+10:00",
    checkboxes: [
      { label: "Discussed with employee", checked: true },
    ],
  },
  {
    id: "n6",
    employeeName: "Yuki Tanaka",
    employeeRole: "Kitchen Staff",
    kind: "Other",
    summary: "Initial onboarding chat.",
    details: "Walked through kitchen workflow, food safety procedures, and uniform expectations.",
    actionTaken: "Yuki confirmed understanding and was issued the staff handbook.",
    addedBy: "Store Manager",
    createdAtISO: "2026-02-02T13:00:00+10:00",
    checkboxes: [
      { label: "Discussed with employee", checked: true },
    ],
  },
  {
    id: "n7",
    employeeName: "Taro Honda",
    employeeRole: "Hall Staff",
    kind: "Performance Review",
    summary: "Mid-year review notes.",
    details: "Strengths: dependable, mentors junior staff well. Areas for growth: speed during opening setup.",
    actionTaken: "Set goal of completing opening setup within 35 minutes. Will review again in 3 months.",
    addedBy: "You (Store Manager)",
    createdAtISO: "2026-01-19T16:00:00+10:00",
    checkboxes: [
      { label: "Goals discussed with employee",         checked: true },
      { label: "Employee given opportunity to respond", checked: true },
    ],
  },
];

function initials(name: string): string {
  const parts = name.split(" ").filter(Boolean);
  const a = parts[0]?.charAt(0) ?? "?";
  const b = parts[1]?.charAt(0) ?? "";
  return (a + b).toUpperCase();
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function kindIcon(kind: NoteKind, size = 28) {
  switch (kind) {
    case "Formal Warning":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      );
    case "Performance Review":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      );
    case "Incident Report":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2L4 6v6c0 5 3.5 9.5 8 10 4.5-.5 8-5 8-10V6l-8-4z" />
          <line x1="12" y1="8" x2="12" y2="13" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      );
    case "Other":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="5" cy="12" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="19" cy="12" r="1.5" />
        </svg>
      );
  }
}

function kindClass(kind: NoteKind): string {
  switch (kind) {
    case "Formal Warning":     return styles.kindWarning;
    case "Performance Review": return styles.kindReview;
    case "Incident Report":    return styles.kindIncident;
    case "Other":              return styles.kindOther;
  }
}

export default function HrNoteDetailPage({
  params,
}: {
  params: Promise<{ noteId: string }>;
}) {
  const router = useRouter();
  const { noteId } = use(params);
  const note = NOTES.find((n) => n.id === noteId);
  if (!note) notFound();

  function handleDelete() {
    if (confirm("Delete this HR note?")) {
      router.push("/people/hr-notes");
    }
  }

  function handleEdit() {
    alert("Edit — coming soon.");
  }

  function handleFollowUp() {
    router.push("/people/hr-notes/add");
  }

  return (
    <div className={styles.page}>
      {/* Black top bar */}
      <div className={styles.topbar}>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => router.push("/people/hr-notes")}
          aria-label="Back"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <p className={styles.topbarTitle}>HR Note Details</p>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={handleDelete}
          aria-label="Delete"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          </svg>
        </button>
      </div>

      {/* Hero */}
      <header className={styles.hero}>
        <span className={`${styles.heroIcon} ${kindClass(note.kind)}`} aria-hidden="true">
          {kindIcon(note.kind, 28)}
        </span>
        <div className={styles.heroBody}>
          <div className={styles.heroHead}>
            <h1 className={styles.heroTitle}>{note.kind}</h1>
            <span className={styles.heroAddedBy}>Added by {note.addedBy.replace(/ \(.*\)$/, "")}</span>
          </div>
          <div className={styles.heroBottom}>
            <p className={styles.heroSummary}>{note.summary}</p>
            <span className={styles.heroDate}>
              {fmtDate(note.createdAtISO)} {fmtTime(note.createdAtISO)}
            </span>
          </div>
        </div>
      </header>

      {/* Employee */}
      <section className={styles.empCard}>
        <span className={styles.empAvatar} aria-hidden="true">
          {initials(note.employeeName)}
        </span>
        <div className={styles.empBody}>
          <p className={styles.empName}>{note.employeeName}</p>
          <p className={styles.empRole}>{note.employeeRole}</p>
          <p className={styles.empLocked}>
            Employee cannot be changed
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </p>
        </div>
        <button type="button" className={styles.viewProfileBtn}>
          View Profile
        </button>
      </section>

      {/* Date / Time / Added by */}
      <section className={styles.metaCard}>
        <div className={styles.metaRow}>
          <span className={styles.metaIcon} aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </span>
          <span className={styles.metaLabel}>Date</span>
          <span className={styles.metaValue}>{fmtDate(note.createdAtISO)}</span>
        </div>
        <div className={styles.metaDivider} />
        <div className={styles.metaRow}>
          <span className={styles.metaIcon} aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </span>
          <span className={styles.metaLabel}>Time</span>
          <span className={styles.metaValue}>{fmtTime(note.createdAtISO)}</span>
        </div>
        <div className={styles.metaDivider} />
        <div className={styles.metaRow}>
          <span className={styles.metaIcon} aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <line x1="20" y1="8" x2="20" y2="14" />
              <line x1="23" y1="11" x2="17" y2="11" />
            </svg>
          </span>
          <span className={styles.metaLabel}>Added by</span>
          <span className={styles.metaValue}>{note.addedBy}</span>
        </div>
      </section>

      {/* Details + Action Taken */}
      <section className={styles.contentCard}>
        <h2 className={styles.contentTitle}>Details</h2>
        <p className={styles.contentHint}>
          {note.kind === "Performance Review"
            ? "Strengths and areas observed during this review."
            : note.kind === "Incident Report"
              ? "What happened, where and when."
              : "Describe the issue and why this warning is being issued."}
        </p>
        <div className={styles.bodyBox}>{note.details}</div>

        <h2 className={styles.contentTitle} style={{ marginTop: "var(--space-5)" }}>Action Taken</h2>
        <p className={styles.contentHint}>Describe what was discussed and any action taken.</p>
        <div className={styles.bodyBox}>{note.actionTaken}</div>

        <ul className={styles.checkList}>
          {note.checkboxes.map((c) => (
            <li key={c.label} className={styles.checkRow}>
              <span className={`${styles.checkMark} ${c.checked ? styles.checkMarkOn : ""}`} aria-hidden="true">
                {c.checked && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </span>
              <span className={styles.checkLabel}>{c.label}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Action buttons */}
      <div className={styles.actionRow}>
        <button type="button" className={styles.editBtn} onClick={handleEdit}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          <span>Edit</span>
        </button>
        <button type="button" className={styles.followUpBtn} onClick={handleFollowUp}>
          Add Follow-up Note
        </button>
      </div>

      <p className={styles.visibility}>This record is visible to managers only.</p>
    </div>
  );
}
