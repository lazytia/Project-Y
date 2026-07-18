"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useRouter, notFound } from "next/navigation";
import {
  doc,
  getDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import {
  followUpCheckboxesForCategory,
  followUpFieldsForCategory,
} from "@/lib/hr-note-config";
import { emailToUsername } from "@/lib/username";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

type NoteKind = "Formal Warning" | "Performance Review" | "Incident Report" | "Other";

type StoredCheckbox = { label: string; checked: boolean };

type FollowUpNote = {
  id: string;
  fields: Record<string, string>;
  checkboxes: StoredCheckbox[];
  addedByUid: string;
  addedByName: string;
  createdAt?: Timestamp | null;
};

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
  followUps?: FollowUpNote[];
};

const MAX_LEN = 500;

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

function fmtDateTime(d: Date | null): string {
  if (!d) return "";
  return `${fmtDate(d)} ${fmtTime(d)}`;
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

function addedByNameFromEmail(email: string | null | undefined): string {
  const u = emailToUsername(email ?? "");
  if (!u) return "Manager";
  return u.charAt(0).toUpperCase() + u.slice(1);
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
    case "Formal Warning":
      return styles.kindWarning;
    case "Performance Review":
      return styles.kindReview;
    case "Incident Report":
      return styles.kindIncident;
    case "Other":
      return styles.kindOther;
  }
}

function parseFollowUps(raw: unknown): FollowUpNote[] {
  if (!Array.isArray(raw)) return [];
  const out: FollowUpNote[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : "";
    if (!id) continue;
    out.push({
      id,
      fields: (o.fields as Record<string, string>) ?? {},
      checkboxes: (o.checkboxes as StoredCheckbox[]) ?? [],
      addedByUid: String(o.addedByUid ?? ""),
      addedByName: String(o.addedByName ?? ""),
      createdAt: (o.createdAt as Timestamp | null | undefined) ?? null,
    });
  }
  return out;
}

function emptyFollowUp(category: string, user: { uid: string; email: string | null }): FollowUpNote {
  const fields = followUpFieldsForCategory(category);
  const checkboxes = followUpCheckboxesForCategory(category);
  return {
    id: crypto.randomUUID(),
    fields: Object.fromEntries(fields.map((f) => [f.label, ""])),
    checkboxes: checkboxes.map((label) => ({ label, checked: false })),
    addedByUid: user.uid,
    addedByName: addedByNameFromEmail(user.email),
    createdAt: null,
  };
}

function isDraftFollowUp(fu: FollowUpNote): boolean {
  return !tsDate(fu.createdAt);
}

function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={open ? styles.chevronOpen : styles.chevronClosed}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  const isImage =
    value.startsWith("data:image/") || value.startsWith("https://") || value.startsWith("http://");
  if (/photo|attach/i.test(label)) {
    if (isImage) {
      return (
        <div className={styles.noteFieldBlock}>
          <h3 className={styles.contentTitle}>{label}</h3>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt={label} className={styles.notePhoto} />
        </div>
      );
    }
    return null;
  }
  if (!value.trim()) return null;
  return (
    <div className={styles.noteFieldBlock}>
      <h3 className={styles.contentTitle}>{label}</h3>
      <div className={styles.bodyBox}>{value}</div>
    </div>
  );
}

function ReadOnlyChecks({ items }: { items: StoredCheckbox[] }) {
  if (items.length === 0) return null;
  return (
    <ul className={styles.checkList}>
      {items.map((c) => (
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
  );
}

export default function HrNoteDetailPage({
  params,
}: {
  params: Promise<{ noteId: string }>;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const { noteId } = use(params);
  const [note, setNote] = useState<StoredNote | null>(null);
  const [followUps, setFollowUps] = useState<FollowUpNote[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["original"]));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fieldDefs = useMemo(
    () => (note ? followUpFieldsForCategory(note.category) : []),
    [note],
  );

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(getDb(), "hr_notes", noteId));
        if (snap.exists()) {
          const data = snap.data() as StoredNote;
          setNote(data);
          const parsed = parseFollowUps(data.followUps);
          setFollowUps(parsed);
          setExpanded(new Set(["original", ...parsed.filter(isDraftFollowUp).map((f) => f.id)]));
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [noteId]);

  if (loading) return <Splash />;
  if (!note) notFound();

  const createdAt = tsDate(note.createdAt);
  const hasDrafts = followUps.some(isDraftFollowUp);
  const category = note.category;

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleAddFollowUp() {
    if (!user) return;
    const draft = emptyFollowUp(category, user);
    setFollowUps((prev) => [...prev, draft]);
    setExpanded((prev) => new Set([...prev, draft.id]));
  }

  function updateFollowUpField(id: string, label: string, value: string) {
    setFollowUps((prev) =>
      prev.map((fu) =>
        fu.id === id
          ? { ...fu, fields: { ...fu.fields, [label]: value.slice(0, MAX_LEN) } }
          : fu,
      ),
    );
  }

  function toggleFollowUpCheck(id: string, label: string) {
    setFollowUps((prev) =>
      prev.map((fu) =>
        fu.id === id
          ? {
              ...fu,
              checkboxes: fu.checkboxes.map((c) =>
                c.label === label ? { ...c, checked: !c.checked } : c,
              ),
            }
          : fu,
      ),
    );
  }

  async function handleSaveChanges() {
    if (!user) return;
    const drafts = followUps.filter(isDraftFollowUp);
    for (const fu of drafts) {
      const hasText = Object.values(fu.fields).some((v) => v.trim().length > 0);
      if (!hasText) {
        alert("Please fill in at least one field before saving a follow-up note.");
        return;
      }
    }
    setSaving(true);
    try {
      // Firestore rejects serverTimestamp() inside array elements
      // ("serverTimestamp() is not currently supported inside arrays"),
      // so stamp new follow-ups with a client-side Timestamp.now() — it's
      // milliseconds-off from a server timestamp but keeps the timeline
      // usable and matches what other apps do for array items.
      const payload = followUps.map((fu) => ({
        id: fu.id,
        fields: fu.fields,
        checkboxes: fu.checkboxes,
        addedByUid: fu.addedByUid || user.uid,
        addedByName: fu.addedByName || addedByNameFromEmail(user.email),
        createdAt: fu.createdAt ?? Timestamp.now(),
      }));
      await updateDoc(doc(getDb(), "hr_notes", noteId), { followUps: payload });
      const snap = await getDoc(doc(getDb(), "hr_notes", noteId));
      if (snap.exists()) {
        const refreshed = parseFollowUps((snap.data() as StoredNote).followUps);
        setFollowUps(refreshed);
        setExpanded(new Set(["original"]));
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  function handleEdit() {
    router.push(`/people/hr-notes/add/${category}?edit=${noteId}`);
  }

  return (
    <div className={styles.page}>
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
        <span />
      </div>

      <header className={styles.hero}>
        <span className={`${styles.heroIcon} ${kindClass(note.kind)}`} aria-hidden="true">
          {kindIcon(note.kind, 28)}
        </span>
        <div className={styles.heroBody}>
          <h1 className={styles.heroTitle}>{note.kind}</h1>
          <span className={styles.heroAddedBy}>Added by {note.addedByName}</span>
          <div className={styles.heroBottom}>
            <span className={styles.heroDate}>
              {fmtDate(createdAt)} {fmtTime(createdAt)}
            </span>
          </div>
        </div>
      </header>

      <section className={styles.empCard}>
        <span className={styles.empAvatar} aria-hidden="true">
          {initials(note.employeeName)}
        </span>
        <div className={styles.empBody}>
          <p className={styles.empName}>{note.employeeName}</p>
          <p className={styles.empRole}>{note.employeeRole ?? "Staff"}</p>
        </div>
      </section>

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

      <section className={styles.notesSection}>
        <h2 className={styles.notesSectionTitle}>Notes</h2>

        <article className={styles.noteEntry}>
          <button
            type="button"
            className={styles.noteEntryHead}
            onClick={() => toggleExpanded("original")}
            aria-expanded={expanded.has("original")}
          >
            <div className={styles.noteEntryHeadLeft}>
              <span className={styles.noteNumber}>Note #1</span>
              <span className={`${styles.noteBadge} ${styles.noteBadgeCurrent}`}>Current</span>
            </div>
            <div className={styles.noteEntryHeadRight}>
              <span className={styles.noteMeta}>
                {fmtDateTime(createdAt)} by {note.addedByName}
              </span>
              <ChevronDown open={expanded.has("original")} />
            </div>
          </button>
          {expanded.has("original") && (
            <div className={styles.noteEntryBody}>
              {Object.entries(note.fields ?? {}).map(([label, value]) => (
                <ReadOnlyField key={label} label={label} value={value} />
              ))}
              <ReadOnlyChecks items={note.checkboxes ?? []} />
            </div>
          )}
        </article>

        {followUps.map((fu, idx) => {
          const draft = isDraftFollowUp(fu);
          const fuDate = tsDate(fu.createdAt);
          const isOpen = expanded.has(fu.id);
          return (
            <article key={fu.id} className={styles.noteEntry}>
              <button
                type="button"
                className={styles.noteEntryHead}
                onClick={() => toggleExpanded(fu.id)}
                aria-expanded={isOpen}
              >
                <div className={styles.noteEntryHeadLeft}>
                  <span className={styles.noteNumber}>Note #{idx + 2}</span>
                  <span className={`${styles.noteBadge} ${draft ? styles.noteBadgeDraft : styles.noteBadgeSaved}`}>
                    {draft ? "Draft" : "Follow-up"}
                  </span>
                </div>
                <div className={styles.noteEntryHeadRight}>
                  <span className={styles.noteMeta}>
                    {draft ? "Unsaved" : fmtDateTime(fuDate)} by {fu.addedByName}
                  </span>
                  <ChevronDown open={isOpen} />
                </div>
              </button>
              {isOpen && (
                <div className={styles.noteEntryBody}>
                  {draft ? (
                    <>
                      {fieldDefs.map((f) => (
                        <div key={f.label} className={styles.noteFieldBlock}>
                          <h3 className={styles.contentTitle}>{f.label}</h3>
                          {f.hint ? <p className={styles.contentHint}>{f.hint}</p> : null}
                          <textarea
                            className={styles.fieldTextarea}
                            value={fu.fields[f.label] ?? ""}
                            placeholder={f.placeholder}
                            rows={4}
                            maxLength={f.maxLength ?? MAX_LEN}
                            onChange={(e) => updateFollowUpField(fu.id, f.label, e.target.value)}
                          />
                        </div>
                      ))}
                      {fu.checkboxes.length > 0 && (
                        <ul className={styles.checkListEditable}>
                          {fu.checkboxes.map((c) => (
                            <li key={c.label}>
                              <button
                                type="button"
                                className={styles.checkRowBtn}
                                onClick={() => toggleFollowUpCheck(fu.id, c.label)}
                              >
                                <span className={`${styles.checkMark} ${c.checked ? styles.checkMarkOn : ""}`}>
                                  {c.checked && (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                      <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                  )}
                                </span>
                                <span className={styles.checkLabel}>{c.label}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  ) : (
                    <>
                      {Object.entries(fu.fields).map(([label, value]) => (
                        <ReadOnlyField key={label} label={label} value={value} />
                      ))}
                      <ReadOnlyChecks items={fu.checkboxes} />
                    </>
                  )}
                </div>
              )}
            </article>
          );
        })}

        <button type="button" className={styles.addFollowUpBtn} onClick={handleAddFollowUp}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Follow-up Note
        </button>
      </section>

      <div className={styles.infoBox}>
        <span className={styles.infoIcon} aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </span>
        <p className={styles.infoText}>
          To keep a clear record, notes cannot be deleted. If a note was added in error, please edit it to update the information.
        </p>
      </div>

      <div className={styles.footerActions}>
        <button type="button" className={styles.editBtn} onClick={handleEdit}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          <span>Edit</span>
        </button>
        <button
          type="button"
          className={styles.saveBtn}
          onClick={handleSaveChanges}
          disabled={saving || !hasDrafts}
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>

      <p className={styles.visibility}>This record is visible to managers only.</p>
    </div>
  );
}
