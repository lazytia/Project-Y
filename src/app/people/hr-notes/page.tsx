"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  collection,
  getDocs,
  orderBy,
  query,
  type Timestamp,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

/* ──────────────────────────────────────────────────────────────────────
 * HR notes live in the top-level Firestore collection `hr_notes`. Add
 * Note step 2 writes to it; this page reads from it.
 * ──────────────────────────────────────────────────────────────────── */

type NoteKind = "Formal Warning" | "Performance Review" | "Incident Report" | "Other";

type StoredCheckbox = { label: string; checked: boolean };

type StoredNote = {
  id: string;
  category: string;
  kind: NoteKind;
  employeeUid: string;
  employeeName: string;
  employeeRole?: string;
  date: string;
  fields: Record<string, string>;
  checkboxes: StoredCheckbox[];
  addedByUid: string;
  addedByName: string;
  createdAt?: Timestamp;
};

type Note = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeRole: string;
  kind: NoteKind;
  body: string;
  addedBy: string;
  createdAt: Date | null;
};

type StaffDoc = {
  uid: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  role?: string;
};

type Member = {
  id: string;
  firstName: string;
  lastName: string;
  role: "Staff" | "Manager";
  active: boolean;
};

type ViewMode = "timeline" | "byEmployee";
type Sort = "az" | "za" | "mostNotes" | "recent";

const SORT_OPTIONS: { key: Sort; label: string }[] = [
  { key: "az",        label: "A–Z" },
  { key: "za",        label: "Z–A" },
  { key: "mostNotes", label: "Most Notes" },
  { key: "recent",    label: "Most Recent Note" },
];

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

function fmtDate(d: Date | null): string {
  if (!d) return "";
  return d.toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtTime(d: Date | null): string {
  if (!d) return "";
  return d.toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function pickBody(fields: Record<string, string>): string {
  // First non-empty field is what we show as the timeline body. Skip
  // image data URLs and legacy photo-field filenames so the snippet is
  // always readable text.
  for (const [label, v] of Object.entries(fields ?? {})) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (!t || t.startsWith("data:image/")) continue;
    if (/photo|attach/i.test(label)) continue;
    return t;
  }
  return "";
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
  const router = useRouter();
  const searchParams = useSearchParams();
  // Deep-links from other surfaces (e.g. the Employee Details HR Notes row)
  // can seed the search box via ?search=<name> so the page opens already
  // filtered to that person.
  const initialSearch = searchParams?.get("search") ?? "";
  const [view, setView] = useState<ViewMode>("timeline");
  const [query_, setQuery] = useState(initialSearch);
  const [sort, setSort] = useState<Sort>("az");
  const [sortOpen, setSortOpen] = useState(false);

  const [notes, setNotes] = useState<Note[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [notesSnap, staffSnap] = await Promise.all([
          getDocs(query(collection(getDb(), "hr_notes"), orderBy("createdAt", "desc"))),
          getDocs(collection(getDb(), "staff_onboarding")),
        ]);

        const parsedNotes: Note[] = notesSnap.docs.map((dSnap) => {
          const d = { id: dSnap.id, ...(dSnap.data() as Omit<StoredNote, "id">) };
          return {
            id: d.id,
            employeeId: d.employeeUid,
            employeeName: d.employeeName,
            employeeRole: d.employeeRole ?? "Staff",
            kind: d.kind,
            body: pickBody(d.fields ?? {}),
            addedBy: d.addedByName,
            createdAt: tsDate(d.createdAt),
          };
        });

        const parsedMembers: Member[] = staffSnap.docs
          .map((dSnap) => ({ uid: dSnap.id, ...(dSnap.data() as Omit<StaffDoc, "uid">) }))
          .filter((d) => d.role !== "owner")
          .map((d) => {
            const { firstName, lastName } = displayName(d);
            return {
              id: d.uid,
              firstName,
              lastName,
              role: d.role === "manager" ? "Manager" : "Staff",
              active: true,
            };
          });

        setNotes(parsedNotes);
        setMembers(parsedMembers);
      } catch {
        /* keep empty */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Split the query into individual whitespace tokens so a deep-link
  // that carries a full name like "Yurico Oo" still matches notes for
  // "Yurico" alone (any token contained in the target counts as a hit).
  const queryTokens = useMemo(
    () =>
      query_
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 0),
    [query_],
  );

  function anyTokenMatches(haystack: string): boolean {
    if (queryTokens.length === 0) return true;
    const lower = haystack.toLowerCase();
    return queryTokens.some((t) => lower.includes(t));
  }

  // ── Timeline: filter by query, sort by date desc ──
  const timeline = useMemo(() => {
    if (queryTokens.length === 0) return notes;
    return notes.filter(
      (n) =>
        anyTokenMatches(n.employeeName) ||
        anyTokenMatches(n.kind) ||
        anyTokenMatches(n.body),
    );
    // anyTokenMatches is stable per queryTokens value; safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, queryTokens]);

  // ── By Employee: each member + their last note ──
  const byEmployee = useMemo(() => {
    const rows = members.filter((m) => {
      if (queryTokens.length === 0) return true;
      return anyTokenMatches(`${m.firstName} ${m.lastName}`);
    }).map((m) => {
      const notesForMember = notes
        .filter((n) => n.employeeId === m.id)
        .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
      const last = notesForMember[0];
      return {
        ...m,
        notes: notesForMember,
        notesCount: notesForMember.length,
        lastKind: last?.kind,
        lastAt: last?.createdAt ?? null,
      };
    });
    rows.sort((a, b) => {
      switch (sort) {
        case "az": return a.firstName.localeCompare(b.firstName);
        case "za": return b.firstName.localeCompare(a.firstName);
        case "mostNotes":
          return (b.notesCount - a.notesCount) || a.firstName.localeCompare(b.firstName);
        case "recent":
          return (b.lastAt?.getTime() ?? 0) - (a.lastAt?.getTime() ?? 0);
      }
    });
    return rows;
    // anyTokenMatches is stable per queryTokens value; safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, notes, queryTokens, sort]);

  function handleAddNote() {
    router.push("/people/hr-notes/add");
  }

  function toggleMember(id: string, hasNotes: boolean) {
    if (!hasNotes) return;
    setExpandedId((cur) => (cur === id ? null : id));
  }

  function openNote(n: Note) {
    router.push(`/people/hr-notes/${n.id}`);
  }

  if (loading) return <Splash />;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>HR Notes</h1>
        <p className={styles.subtitle}>Manager only. Important records only.</p>
      </header>

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
            value={query_}
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

      {view === "timeline" && (
        <>
          <p className={styles.sectionLabel}>TIMELINE</p>
          {timeline.length === 0 ? (
            <p className={styles.empty}>
              {notes.length === 0
                ? "No notes yet. Tap Add Note to record one."
                : "No notes match the search."}
            </p>
          ) : (
            <ol className={styles.timelineList}>
              {timeline.map((n) => (
                <li key={n.id} className={styles.timelineRow}>
                  <div className={styles.timelineMarker}>
                    <span className={styles.timelineDot} aria-hidden="true" />
                  </div>
                  <div className={styles.timelineDateCol}>
                    <p className={styles.timelineDate}>{fmtDate(n.createdAt)}</p>
                    <p className={styles.timelineTime}>{fmtTime(n.createdAt)}</p>
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
                      {n.body && <p className={styles.timelineNote}>{n.body}</p>}
                    </div>
                    <span className={styles.chev} aria-hidden="true">›</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </>
      )}

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

          {members.length === 0 ? (
            <p className={styles.empty}>No staff registered yet. Create one from People → Staff +.</p>
          ) : byEmployee.length === 0 ? (
            <p className={styles.empty}>No team members match.</p>
          ) : (
            <ul className={styles.empList}>
              {byEmployee.map((m) => {
                const isOpen = expandedId === m.id;
                const hasNotes = m.notesCount > 0;
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      className={`${styles.empRow} ${isOpen ? styles.empRowOpen : ""}`}
                      onClick={() => toggleMember(m.id, hasNotes)}
                      aria-expanded={hasNotes ? isOpen : undefined}
                      aria-controls={hasNotes ? `notes-${m.id}` : undefined}
                    >
                      <div className={styles.empBody}>
                        <p className={styles.empName}>{m.firstName} {m.lastName}</p>
                        <p className={styles.empSub}>
                          <span>{m.role}</span>
                          {m.active && (
                            <>
                              <span className={styles.dotSep} aria-hidden="true">·</span>
                              <span className={styles.activeText}>
                                <span className={styles.dotGreen} aria-hidden="true" />
                                Active
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                      <div className={styles.empMeta}>
                        {hasNotes && m.lastKind ? (
                          <>
                            <span className={`${styles.empTypeIcon} ${kindClass(m.lastKind)}`} aria-hidden="true">
                              {kindIcon(m.lastKind, 14)}
                            </span>
                            <div className={styles.empMetaText}>
                              <p className={styles.notesCount}>
                                <strong>{m.notesCount}</strong> {m.notesCount === 1 ? "note" : "notes"}
                              </p>
                              <p className={styles.lastDate}>{m.lastAt ? fmtDate(m.lastAt) : ""}</p>
                            </div>
                          </>
                        ) : (
                          <p className={styles.noNotes}>No notes</p>
                        )}
                      </div>
                      {hasNotes ? (
                        <span className={`${styles.empChev} ${isOpen ? styles.empChevOpen : ""}`} aria-hidden="true">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </span>
                      ) : (
                        <span />
                      )}
                    </button>

                    {isOpen && hasNotes && (
                      <ul id={`notes-${m.id}`} className={styles.subNoteList}>
                        {m.notes.map((n) => (
                          <li key={n.id}>
                            <button
                              type="button"
                              className={styles.subNoteRow}
                              onClick={() => openNote(n)}
                            >
                              <span className={`${styles.subNoteIcon} ${kindClass(n.kind)}`} aria-hidden="true">
                                {kindIcon(n.kind, 14)}
                              </span>
                              <div className={styles.subNoteBody}>
                                <p className={styles.subNoteKind}>{n.kind}</p>
                                {n.body && <p className={styles.subNoteText}>{n.body}</p>}
                              </div>
                              <span className={styles.subNoteDate}>{fmtDate(n.createdAt)}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

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
