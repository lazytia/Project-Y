"use client";

import { useMemo, useState } from "react";
import styles from "./page.module.css";

/* ──────────────────────────────────────────────────────────────────────
 * Placeholder team-members + last-note summary. Will be replaced with a
 * Firestore query over staff_onboarding + a notes subcollection in a
 * follow-up.
 * ──────────────────────────────────────────────────────────────────── */

type Role = "Hall Staff" | "Kitchen Staff" | "Manager";
type LastNoteKind = "Formal Warning" | "Performance Review" | "Incident Report";

type Member = {
  id: string;
  firstName: string;
  lastName: string;
  role: Role;
  active: boolean;
  notesCount: number;
  lastNoteKind?: LastNoteKind;
  lastNoteISO?: string;
};

const MEMBERS: Member[] = [
  { id: "yt", firstName: "Yuki",   lastName: "Tanaka",   role: "Kitchen Staff", active: true, notesCount: 2, lastNoteKind: "Formal Warning",    lastNoteISO: "2026-06-12" },
  { id: "sl", firstName: "Sam",    lastName: "Lee",      role: "Hall Staff",    active: true, notesCount: 1, lastNoteKind: "Performance Review", lastNoteISO: "2026-03-03" },
  { id: "hs", firstName: "Hiyori", lastName: "Sato",     role: "Kitchen Staff", active: true, notesCount: 0 },
  { id: "kw", firstName: "Kenji",  lastName: "Watanabe", role: "Hall Staff",    active: true, notesCount: 1, lastNoteKind: "Incident Report",    lastNoteISO: "2026-04-10" },
  { id: "mc", firstName: "Mei",    lastName: "Chen",     role: "Kitchen Staff", active: true, notesCount: 1, lastNoteKind: "Formal Warning",    lastNoteISO: "2026-06-08" },
  { id: "th", firstName: "Taro",   lastName: "Honda",    role: "Hall Staff",    active: true, notesCount: 2, lastNoteKind: "Performance Review", lastNoteISO: "2026-05-01" },
  { id: "ay", firstName: "Aya",    lastName: "Yamamoto", role: "Kitchen Staff", active: true, notesCount: 1, lastNoteKind: "Incident Report",    lastNoteISO: "2026-04-29" },
  { id: "rk", firstName: "Ryo",    lastName: "Kimura",   role: "Hall Staff",    active: true, notesCount: 0 },
];

type Sort = "az" | "za" | "mostNotes" | "recent";

const SORT_OPTIONS: { key: Sort; label: string }[] = [
  { key: "az",        label: "A–Z" },
  { key: "za",        label: "Z–A" },
  { key: "mostNotes", label: "Most Notes" },
  { key: "recent",    label: "Most Recent Note" },
];

function initials(m: Member): string {
  return (m.firstName.charAt(0) + m.lastName.charAt(0)).toUpperCase();
}

function fmtDate(iso: string): string {
  const [y, mo, d] = iso.split("-").map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function HrNotesPage() {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("az");
  const [sortOpen, setSortOpen] = useState(false);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = MEMBERS.filter((m) => {
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
          const ax = a.lastNoteISO ?? "";
          const bx = b.lastNoteISO ?? "";
          return bx.localeCompare(ax);
        }
      }
    });
    return sorted;
  }, [query, sort]);

  function handleAddNote() {
    alert("Add Note — coming soon.\n\nA dialog to pick the employee and note type will land here.");
  }

  function openMember(m: Member) {
    alert(`${m.firstName} ${m.lastName} — notes detail page coming soon.`);
  }

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

      <ul className={styles.list}>
        {list.map((m) => (
          <li key={m.id}>
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
                {m.notesCount > 0 && m.lastNoteKind ? (
                  <>
                    <p className={styles.lastLabel}>Last: {m.lastNoteKind}</p>
                    <p className={styles.lastDate}>{m.lastNoteISO ? fmtDate(m.lastNoteISO) : ""}</p>
                  </>
                ) : (
                  <p className={styles.lastLabel}>—</p>
                )}
              </div>
              <span className={styles.chev} aria-hidden="true">›</span>
            </button>
          </li>
        ))}
        {list.length === 0 && (
          <li className={styles.empty}>No team members match.</li>
        )}
      </ul>
    </div>
  );
}
