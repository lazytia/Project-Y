"use client";

import { useMemo, useState } from "react";
import styles from "./page.module.css";

/* ──────────────────────────────────────────────────────────────────────
 * Placeholder HR notes. Real data will come from a Firestore subcollection
 * (staff_onboarding/{uid}/hr_notes/{id}) once the Add Note dialog is wired
 * up. Shape here mirrors what the dialog will write.
 * ──────────────────────────────────────────────────────────────────── */

type NoteKind = "Formal Warning" | "Performance Review" | "Incident Report" | "Other";

type Note = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeRole: "Hall Staff" | "Kitchen Staff" | "Manager";
  kind: NoteKind;
  body: string;
  addedBy: string;
  /** ISO timestamp e.g. "2026-06-12T10:15:00+10:00" */
  createdAtISO: string;
};

type Member = {
  id: string;
  firstName: string;
  lastName: string;
  role: "Hall Staff" | "Kitchen Staff" | "Manager";
  active: boolean;
};

const MEMBERS: Member[] = [
  { id: "yt", firstName: "Yuki",   lastName: "Tanaka",   role: "Kitchen Staff", active: true },
  { id: "sl", firstName: "Sam",    lastName: "Lee",      role: "Hall Staff",    active: true },
  { id: "hs", firstName: "Hiyori", lastName: "Sato",     role: "Kitchen Staff", active: true },
  { id: "kw", firstName: "Kenji",  lastName: "Watanabe", role: "Hall Staff",    active: true },
  { id: "mc", firstName: "Mei",    lastName: "Chen",     role: "Kitchen Staff", active: true },
  { id: "th", firstName: "Taro",   lastName: "Honda",    role: "Hall Staff",    active: true },
  { id: "ay", firstName: "Aya",    lastName: "Yamamoto", role: "Kitchen Staff", active: true },
  { id: "rk", firstName: "Ryo",    lastName: "Kimura",   role: "Hall Staff",    active: true },
];

const NOTES: Note[] = [
  { id: "n1", employeeId: "yt", employeeName: "Yuki Tanaka",   employeeRole: "Kitchen Staff", kind: "Formal Warning",    body: "Repeated late arrival without prior notice.", addedBy: "You",            createdAtISO: "2026-06-12T10:15:00+10:00" },
  { id: "n2", employeeId: "sl", employeeName: "Sam Lee",       employeeRole: "Hall Staff",    kind: "Performance Review", body: "Quarterly review completed.",                addedBy: "You",            createdAtISO: "2026-06-03T14:30:00+10:00" },
  { id: "n3", employeeId: "kw", employeeName: "Kenji Watanabe", employeeRole: "Hall Staff",    kind: "Incident Report",    body: "Customer complaint regarding service.",      addedBy: "Store Manager",  createdAtISO: "2026-04-10T09:45:00+10:00" },
  { id: "n4", employeeId: "mc", employeeName: "Mei Chen",      employeeRole: "Kitchen Staff", kind: "Formal Warning",    body: "Policy violation: Unauthorised absence.",    addedBy: "You",            createdAtISO: "2026-03-01T11:00:00+10:00" },
  { id: "n5", employeeId: "th", employeeName: "Taro Honda",    employeeRole: "Hall Staff",    kind: "Other",              body: "Discussed availability change request.",      addedBy: "You",            createdAtISO: "2026-02-14T15:20:00+10:00" },
  { id: "n6", employeeId: "yt", employeeName: "Yuki Tanaka",   employeeRole: "Kitchen Staff", kind: "Other",              body: "Initial onboarding chat.",                   addedBy: "Store Manager",  createdAtISO: "2026-02-02T13:00:00+10:00" },
  { id: "n7", employeeId: "th", employeeName: "Taro Honda",    employeeRole: "Hall Staff",    kind: "Performance Review", body: "Mid-year review notes.",                     addedBy: "You",            createdAtISO: "2026-01-19T16:00:00+10:00" },
];

type ViewMode = "timeline" | "byEmployee";
type Sort = "az" | "za" | "mostNotes" | "recent";

const SORT_OPTIONS: { key: Sort; label: string }[] = [
  { key: "az",        label: "A–Z" },
  { key: "za",        label: "Z–A" },
  { key: "mostNotes", label: "Most Notes" },
  { key: "recent",    label: "Most Recent Note" },
];

/* ── helpers ── */

function initials(first: string, last: string): string {
  return ((first.charAt(0) || "?") + (last.charAt(0) || "")).toUpperCase();
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-AU", {
    day: "2-digit",
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

function kindIcon(kind: NoteKind, size = 22): React.ReactElement {
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
    case "Formal Warning":    return styles.kindWarning;
    case "Performance Review": return styles.kindReview;
    case "Incident Report":    return styles.kindIncident;
    case "Other":              return styles.kindOther;
  }
}

export default function HrNotesPage() {
  const [view, setView] = useState<ViewMode>("timeline");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("az");
  const [sortOpen, setSortOpen] = useState(false);

  // ── Timeline: filter by query, sort by date desc ──
  const timeline = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = NOTES.filter((n) => {
      if (!q) return true;
      return (
        n.employeeName.toLowerCase().includes(q) ||
        n.kind.toLowerCase().includes(q) ||
        n.body.toLowerCase().includes(q)
      );
    });
    list.sort((a, b) => b.createdAtISO.localeCompare(a.createdAtISO));
    return list;
  }, [query]);

  // ── By Employee: each member + their last note ──
  const byEmployee = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = MEMBERS.filter((m) => {
      if (!q) return true;
      return `${m.firstName} ${m.lastName}`.toLowerCase().includes(q);
    }).map((m) => {
      const notesForMember = NOTES
        .filter((n) => n.employeeId === m.id)
        .sort((a, b) => b.createdAtISO.localeCompare(a.createdAtISO));
      const last = notesForMember[0];
      return {
        ...m,
        notesCount: notesForMember.length,
        lastKind: last?.kind,
        lastISO: last?.createdAtISO,
      };
    });
    rows.sort((a, b) => {
      switch (sort) {
        case "az": return a.firstName.localeCompare(b.firstName);
        case "za": return b.firstName.localeCompare(a.firstName);
        case "mostNotes":
          return (b.notesCount - a.notesCount) || a.firstName.localeCompare(b.firstName);
        case "recent":
          return (b.lastISO ?? "").localeCompare(a.lastISO ?? "");
      }
    });
    return rows;
  }, [query, sort]);

  function handleAddNote() {
    alert("Add Note — coming soon.\n\nA dialog to pick the employee and note type will land here.");
  }

  function openMember(name: string) {
    alert(`${name} — notes detail page coming soon.`);
  }

  function openNote(n: Note) {
    alert(`${n.employeeName} — ${n.kind}\n\n${n.body}\n\nAdded by ${n.addedBy}.`);
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>HR Notes</h1>
        <p className={styles.subtitle}>Manager only. Important records only.</p>
      </header>

      {/* View mode toggle */}
      <div className={styles.viewToggle} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={view === "timeline"}
          className={`${styles.viewTab} ${view === "timeline" ? styles.viewTabActive : ""}`}
          onClick={() => setView("timeline")}
        >
          Timeline
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "byEmployee"}
          className={`${styles.viewTab} ${view === "byEmployee" ? styles.viewTabActive : ""}`}
          onClick={() => setView("byEmployee")}
        >
          By Employee
        </button>
      </div>

      {/* Search + Add Note */}
      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <svg className={styles.searchIcon} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className={styles.searchInput}
            placeholder={view === "timeline" ? "Search employee or note…" : "Search employee…"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <button type="button" className={styles.addBtn} onClick={handleAddNote}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>Add Note</span>
        </button>
      </div>

      {/* Timeline view */}
      {view === "timeline" && (
        <>
          <p className={styles.sectionLabel}>TIMELINE</p>
          {timeline.length === 0 ? (
            <p className={styles.empty}>No notes match.</p>
          ) : (
            <ol className={styles.timelineList}>
              {timeline.map((n) => (
                <li key={n.id} className={styles.timelineRow}>
                  <div className={styles.timelineMarker}>
                    <span className={styles.timelineDot} aria-hidden="true" />
                  </div>
                  <div className={styles.timelineDateCol}>
                    <p className={styles.timelineDate}>{fmtDate(n.createdAtISO)}</p>
                    <p className={styles.timelineTime}>{fmtTime(n.createdAtISO)}</p>
                  </div>
                  <button
                    type="button"
                    className={styles.timelineBody}
                    onClick={() => openNote(n)}
                  >
                    <span className={`${styles.timelineKindIcon} ${kindClass(n.kind)}`} aria-hidden="true">
                      {kindIcon(n.kind, 22)}
                    </span>
                    <div className={styles.timelineBodyText}>
                      <div className={styles.timelineHead}>
                        <span className={styles.timelineName}>{n.employeeName}</span>
                        <span className={styles.timelineAddedBy}>Added by {n.addedBy}</span>
                      </div>
                      <p className={styles.timelineKind}>{n.kind}</p>
                      <p className={styles.timelineNote}>{n.body}</p>
                    </div>
                    <span className={styles.chev} aria-hidden="true">›</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </>
      )}

      {/* By Employee view */}
      {view === "byEmployee" && (
        <>
          <div className={styles.byEmployeeHeader}>
            <p className={styles.sectionLabel}>EMPLOYEES ({byEmployee.length})</p>
            <div className={styles.sortWrap}>
              <button
                type="button"
                className={styles.sortBtn}
                onClick={() => setSortOpen((o) => !o)}
                aria-haspopup="listbox"
                aria-expanded={sortOpen}
              >
                <span className={styles.sortLabel}>Sort by:</span>{" "}
                <span className={styles.sortValue}>
                  {SORT_OPTIONS.find((s) => s.key === sort)?.label}
                </span>
                <span className={`${styles.sortChev} ${sortOpen ? styles.sortChevOpen : ""}`} aria-hidden="true">▾</span>
              </button>
              {sortOpen && (
                <>
                  <div className={styles.sortBackdrop} onClick={() => setSortOpen(false)} />
                  <ul className={styles.sortMenu} role="listbox">
                    {SORT_OPTIONS.map((opt) => (
                      <li key={opt.key}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={sort === opt.key}
                          className={`${styles.sortOption} ${sort === opt.key ? styles.sortOptionActive : ""}`}
                          onClick={() => { setSort(opt.key); setSortOpen(false); }}
                        >
                          {opt.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>

          {byEmployee.length === 0 ? (
            <p className={styles.empty}>No team members match.</p>
          ) : (
            <ul className={styles.empList}>
              {byEmployee.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className={styles.empRow}
                    onClick={() => openMember(`${m.firstName} ${m.lastName}`)}
                  >
                    <div className={styles.avatar} aria-hidden="true">{initials(m.firstName, m.lastName)}</div>
                    <div className={styles.empBody}>
                      <p className={styles.empName}>{m.firstName} {m.lastName}</p>
                      <p className={styles.empRole}>{m.role}</p>
                      {m.active && (
                        <span className={styles.activeBadge}>
                          <span className={styles.dotGreen} aria-hidden="true" />
                          Active
                        </span>
                      )}
                    </div>
                    {m.lastKind ? (
                      <span className={`${styles.empTypeIcon} ${kindClass(m.lastKind)}`} aria-hidden="true">
                        {kindIcon(m.lastKind, 18)}
                      </span>
                    ) : (
                      <span className={`${styles.empTypeIcon} ${styles.kindEmpty}`} aria-hidden="true">
                        —
                      </span>
                    )}
                    <div className={styles.empMeta}>
                      <p className={styles.empCount}>
                        <strong>{m.notesCount}</strong> {m.notesCount === 1 ? "Note" : "Notes"}
                      </p>
                      {m.notesCount > 0 && m.lastKind && m.lastISO ? (
                        <>
                          <p className={styles.empLast}>Last: {m.lastKind}</p>
                          <p className={styles.empDate}>{fmtDate(m.lastISO)}</p>
                        </>
                      ) : (
                        <p className={styles.empLast}>—</p>
                      )}
                    </div>
                    <span className={styles.chev} aria-hidden="true">›</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* Footer note */}
      <div className={styles.footerNote}>
        <span className={styles.footerIcon} aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </span>
        <div className={styles.footerBody}>
          <p className={styles.footerTitle}>Only important records are kept.</p>
          <p className={styles.footerSub}>
            Use this section for Formal Warning, Performance Review, Incident Report or Other.
          </p>
        </div>
      </div>
    </div>
  );
}
