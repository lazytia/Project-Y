"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, type Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

/* ──────────────────────────────────────────────────────────────────────
 * HR notes are stored as an array on the staff_onboarding doc:
 *   hrNotes: [{ id, kind, body, createdAt, authorUid }, …]
 * The schema is open-ended — the Add Note dialog (coming next) will be
 * what populates these. For now we just read whatever's there.
 * ──────────────────────────────────────────────────────────────────── */

type HrNote = {
  id?: string;
  kind?: string; // "Formal Warning" | "Performance Review" | "Incident Report" | ...
  body?: string;
  createdAt?: Timestamp;
};

type StaffDoc = {
  uid: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  role?: string;
  hrNotes?: HrNote[];
};

type Member = {
  uid: string;
  firstName: string;
  lastName: string;
  role: "Staff" | "Manager";
  active: boolean;
  notesCount: number;
  lastNoteKind?: string;
  lastNoteAt?: Date;
};

type Sort = "az" | "za" | "mostNotes" | "recent";

const SORT_OPTIONS: { key: Sort; label: string }[] = [
  { key: "az",        label: "A–Z" },
  { key: "za",        label: "Z–A" },
  { key: "mostNotes", label: "Most Notes" },
  { key: "recent",    label: "Most Recent Note" },
];

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

function initials(m: Member): string {
  return ((m.firstName.charAt(0) || "?") + (m.lastName.charAt(0) || "")).toUpperCase();
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function HrNotesPage() {
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<Member[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("az");
  const [sortOpen, setSortOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(getDb(), "staff_onboarding"));
        const list: Member[] = snap.docs
          .map((dSnap) => ({ uid: dSnap.id, ...(dSnap.data() as Omit<StaffDoc, "uid">) }))
          // Owners excluded.
          .filter((d) => d.role !== "owner")
          .map((d) => {
            const { firstName, lastName } = displayName(d);
            const notes = (d.hrNotes ?? []) as HrNote[];
            // Pick the newest note (by createdAt) for the "Last:" line.
            let lastNoteKind: string | undefined;
            let lastNoteAt: Date | undefined;
            for (const n of notes) {
              const at = tsDate(n.createdAt) ?? undefined;
              if (!at) continue;
              if (!lastNoteAt || at.getTime() > lastNoteAt.getTime()) {
                lastNoteAt = at;
                lastNoteKind = n.kind ?? "Note";
              }
            }
            return {
              uid: d.uid,
              firstName,
              lastName,
              role: d.role === "manager" ? "Manager" : "Staff",
              active: true,
              notesCount: notes.length,
              lastNoteKind,
              lastNoteAt,
            } as Member;
          });
        setMembers(list);
      } catch {
        /* keep empty */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = members.filter((m) => {
      if (!q) return true;
      const full = `${m.firstName} ${m.lastName}`.toLowerCase();
      return full.includes(q) || m.role.toLowerCase().includes(q);
    });
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sort) {
        case "az":
          return a.firstName.localeCompare(b.firstName);
        case "za":
          return b.firstName.localeCompare(a.firstName);
        case "mostNotes":
          return (b.notesCount - a.notesCount) || a.firstName.localeCompare(b.firstName);
        case "recent": {
          const ax = a.lastNoteAt?.getTime() ?? 0;
          const bx = b.lastNoteAt?.getTime() ?? 0;
          return bx - ax;
        }
      }
    });
    return sorted;
  }, [members, query, sort]);

  function handleAddNote() {
    alert("Add Note — coming soon.\n\nA dialog to pick the employee and note type will land here.");
  }

  function openMember(m: Member) {
    alert(`${m.firstName} ${m.lastName} — notes detail page coming soon.`);
  }

  if (loading) return <Splash />;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h1 className={styles.title}>HR Notes</h1>
          <p className={styles.subtitle}>
            Manager only. Record and review important employee matters.
          </p>
        </div>
        <button type="button" className={styles.addBtn} onClick={handleAddNote}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>Add Note</span>
        </button>
      </header>

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

      <div className={styles.listHeader}>
        <p className={styles.listLabel}>TEAM MEMBERS ({list.length})</p>
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
      ) : list.length === 0 ? (
        <p className={styles.empty}>No team members match.</p>
      ) : (
        <ul className={styles.list}>
          {list.map((m) => (
            <li key={m.uid}>
              <button type="button" className={styles.row} onClick={() => openMember(m)}>
                <div className={styles.avatar} aria-hidden="true">{initials(m)}</div>
                <div className={styles.rowBody}>
                  <p className={styles.name}>{m.firstName} {m.lastName}</p>
                  <p className={styles.roleLine}>{m.role}</p>
                  {m.active && (
                    <span className={styles.activeBadge}>
                      <span className={styles.dotGreen} aria-hidden="true" />
                      Active
                    </span>
                  )}
                </div>
                <div className={styles.rowMeta}>
                  <p className={styles.notesCount}>
                    <strong>{m.notesCount}</strong> {m.notesCount === 1 ? "Note" : "Notes"}
                  </p>
                  {m.notesCount > 0 && m.lastNoteKind && m.lastNoteAt ? (
                    <>
                      <p className={styles.lastLabel}>Last: {m.lastNoteKind}</p>
                      <p className={styles.lastDate}>{fmtDate(m.lastNoteAt)}</p>
                    </>
                  ) : (
                    <p className={styles.lastLabel}>—</p>
                  )}
                </div>
                <span className={styles.chev} aria-hidden="true">›</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
