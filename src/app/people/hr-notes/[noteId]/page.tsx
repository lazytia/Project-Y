"use client";

import { use, useEffect, useState } from "react";
import { useRouter, notFound } from "next/navigation";
import {
  deleteDoc,
  doc,
  getDoc,
  type Timestamp,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

/* ──────────────────────────────────────────────────────────────────────
 * HR Note Details — read-only view of a saved note loaded from the
 * `hr_notes` Firestore collection.
 * ──────────────────────────────────────────────────────────────────── */

type NoteKind = "Formal Warning" | "Performance Review" | "Incident Report" | "Other";

type StoredCheckbox = { label: string; checked: boolean };

type StoredNote = {
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

function tsDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object" && v !== null && "toDate" in (v as object)) {
    try { return (v as Timestamp).toDate(); } catch { return null; }
  }
  return null;
}

function initials(name: string): string {
  const parts = name.split(" ").filter(Boolean);
  const a = parts[0]?.charAt(0) ?? "?";
  const b = parts[1]?.charAt(0) ?? "";
  return (a + b).toUpperCase();
}

function fmtDate(d: Date | null): string {
  if (!d) return "";
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
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

function fmtDateIso(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
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

function summaryOf(fields: Record<string, string>): string {
  for (const v of Object.values(fields ?? {})) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (!t || t.startsWith("data:image/")) continue;
    return t.length > 80 ? t.slice(0, 80) + "…" : t;
  }
  return "";
}

export default function HrNoteDetailPage({
  params,
}: {
  params: Promise<{ noteId: string }>;
}) {
  const router = useRouter();
  const { noteId } = use(params);
  const [note, setNote] = useState<StoredNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(getDb(), "hr_notes", noteId));
        if (snap.exists()) {
          setNote(snap.data() as StoredNote);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [noteId]);

  if (loading) return <Splash />;
  if (!note) notFound();

  const createdAt = tsDate(note.createdAt);

  async function handleDelete() {
    if (!confirm("Delete this HR note?")) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(getDb(), "hr_notes", noteId));
      router.push("/people/hr-notes");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete.");
      setDeleting(false);
    }
  }

  function handleEdit() {
    if (!note) return;
    router.push(`/people/hr-notes/add/${note.category}?edit=${noteId}`);
  }

  function handleFollowUp() {
    router.push("/people/hr-notes/add");
  }

  return (
    <div className={styles.page}>
      {/* Light top bar — back left, delete right */}
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
        <span />
        <button
          type="button"
          className={styles.iconBtn}
          onClick={handleDelete}
          disabled={deleting}
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
            <span className={styles.heroAddedBy}>Added by {note.addedByName}</span>
          </div>
          <div className={styles.heroBottom}>
            <p className={styles.heroSummary}>{summaryOf(note.fields ?? {})}</p>
            <span className={styles.heroDate}>
              {fmtDate(createdAt)} {fmtTime(createdAt)}
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
          <p className={styles.empRole}>{note.employeeRole ?? "Staff"}</p>
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
          <span className={styles.metaValue}>{fmtDateIso(note.date)}</span>
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
          <span className={styles.metaValue}>{fmtTime(createdAt)}</span>
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
          <span className={styles.metaValue}>{note.addedByName}</span>
        </div>
      </section>

      {/* Render each saved field */}
      <section className={styles.contentCard}>
        {Object.entries(note.fields ?? {}).map(([label, value], idx) => {
          if (!value) return null;
          const isImage = typeof value === "string" && value.startsWith("data:image/");
          return (
            <div key={label} style={idx > 0 ? { marginTop: "var(--space-5)" } : undefined}>
              <h2 className={styles.contentTitle}>{label}</h2>
              {isImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={value}
                  alt={label}
                  style={{
                    width: "100%",
                    maxHeight: 320,
                    objectFit: "cover",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--color-border)",
                    display: "block",
                  }}
                />
              ) : (
                <div className={styles.bodyBox}>{value}</div>
              )}
            </div>
          );
        })}

        {(note.checkboxes ?? []).length > 0 && (
          <ul className={styles.checkList}>
            {(note.checkboxes ?? []).map((c) => (
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
        )}
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
