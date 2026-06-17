"use client";

import { use, useEffect, useState } from "react";
import { useRouter, useSearchParams, notFound } from "next/navigation";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { emailToUsername } from "@/lib/username";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

/* ──────────────────────────────────────────────────────────────────────
 * Step 2 of the Add HR Note flow. One page, four variants — different
 * title / colours / field labels / checkboxes / submit label per category.
 *
 * Categories: warning | review | incident | other.
 * ──────────────────────────────────────────────────────────────────── */

type Category = "warning" | "review" | "incident" | "other";

type FieldKind = "textarea" | "input" | "time" | "photo";

type FieldConfig = {
  key: string;
  label: string;
  hint: string;
  placeholder?: string;
  kind?: FieldKind;        // default "textarea"
  optional?: boolean;
  maxLength?: number;       // default 500 for textareas, 100 for short inputs
};

type CategoryConfig = {
  title: string;
  subtitle: string;
  iconClass: string;
  icon: (size: number) => React.ReactElement;
  fields: FieldConfig[];
  checkboxes: string[];
  submitLabel: string;
};

type Member = {
  id: string;
  firstName: string;
  lastName: string;
  role: "Staff" | "Manager";
};

type StaffDoc = {
  uid?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  role?: string;
};

function displayName(d: StaffDoc, uid: string): { firstName: string; lastName: string } {
  const f = (d.firstName ?? "").trim();
  const l = (d.lastName ?? "").trim();
  if (f || l) return { firstName: f, lastName: l };
  const u = (d.username ?? "").trim();
  if (u) return { firstName: u.charAt(0).toUpperCase() + u.slice(1), lastName: "" };
  return { firstName: uid.slice(0, 6), lastName: "" };
}

function iconWarning(size: number) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function iconReview(size: number) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function iconIncident(size: number) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L4 6v6c0 5 3.5 9.5 8 10 4.5-.5 8-5 8-10V6l-8-4z" />
      <line x1="12" y1="8" x2="12" y2="13" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function iconOther(size: number) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="19" cy="12" r="1.5" />
    </svg>
  );
}

const CATEGORY_CONFIG: Record<Category, CategoryConfig> = {
  warning: {
    title: "Formal Warning",
    subtitle: "Record a formal warning for the employee.",
    iconClass: "iconWarning",
    icon: iconWarning,
    fields: [
      { key: "details",     label: "Details",      hint: "Describe the issue and why this warning is being issued.", placeholder: "e.g. Arrived 25 minutes late on 15 Jun 2026 without prior notice." },
      { key: "actionTaken", label: "Action Taken", hint: "Describe what was discussed and any action taken.",         placeholder: "e.g. Discussed attendance expectations and store policy. A formal warning was issued." },
    ],
    checkboxes: ["Discussed with employee", "Employee given opportunity to respond"],
    submitLabel: "Save Warning",
  },
  review: {
    title: "Performance Review",
    subtitle: "Record a performance review for the employee.",
    iconClass: "iconReview",
    icon: iconReview,
    fields: [
      { key: "concerns", label: "Performance Concerns", hint: "Describe the performance concerns or areas for improvement.", placeholder: "e.g. Discussed punctuality, communication and roster reliability…" },
      { key: "expectations", label: "Action / Expectations", hint: "Describe what was discussed and the expected improvements.", placeholder: "e.g. Employee was advised to improve attendance and prepare for shifts in advance…" },
    ],
    checkboxes: ["Discussed with employee", "Employee given opportunity to respond"],
    submitLabel: "Save Review",
  },
  incident: {
    title: "Incident Report",
    subtitle: "Record an incident or workplace issue.",
    iconClass: "iconIncident",
    icon: iconIncident,
    fields: [
      { key: "time",        label: "Time (Approx.)", hint: "",                                                kind: "time" },
      { key: "details",     label: "Details",        hint: "Describe what happened.",                          placeholder: "e.g. Customer complained about incorrect order and poor service." },
      { key: "witness",     label: "Witness",        hint: "Who witnessed the incident?",                      placeholder: "e.g. John Smith", kind: "input", optional: true, maxLength: 100 },
      { key: "actionTaken", label: "Action Taken",   hint: "Describe what action was taken.",                  placeholder: "e.g. Apologised to the customer, corrected the order, and reminded staff of service standards." },
      { key: "photo",       label: "Attach Photo",   hint: "",                                                kind: "photo", optional: true },
    ],
    checkboxes: [],
    submitLabel: "Save Report",
  },
  other: {
    title: "Other",
    subtitle: "Record other important matters.",
    iconClass: "iconOther",
    icon: iconOther,
    fields: [
      { key: "details",   label: "Details",          hint: "Describe the matter.",                              placeholder: "e.g. Employee reported that an unknown person visited the store asking questions about staff rosters and management." },
      { key: "outcome",   label: "Action / Outcome", hint: "Describe any action taken or next steps.",          placeholder: "e.g. Management was notified and staff were reminded not to disclose internal information.", optional: true },
    ],
    checkboxes: ["Discussed with employee", "Employee given opportunity to respond"],
    submitLabel: "Save Note",
  },
};

function initials(first: string, last: string) {
  return ((first.charAt(0) || "?") + (last.charAt(0) || "")).toUpperCase();
}

function todayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Resize an image file via canvas so the resulting data URL stays well
 * inside Firestore's 1 MB per-document limit. Long side is capped at
 * MAX_DIM and the JPEG quality is tuned to land under ~600 KB.
 */
async function fileToCompressedDataUrl(file: File): Promise<string> {
  const MAX_DIM = 1280;
  const QUALITY = 0.78;
  const dataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (typeof r === "string") resolve(r);
      else reject(new Error("Could not read file."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Read failed."));
    reader.readAsDataURL(file);
  });

  const img: HTMLImageElement = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Could not load image."));
    i.src = dataUrl;
  });

  const ratio = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * ratio));
  const h = Math.max(1, Math.round(img.height * ratio));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported.");
  ctx.drawImage(img, 0, 0, w, h);

  return canvas.toDataURL("image/jpeg", QUALITY);
}

function fmtDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const MAX_LEN = 500;

export default function AddHrNoteCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { category } = use(params);
  if (!(category in CATEGORY_CONFIG)) notFound();
  const cfg = CATEGORY_CONFIG[category as Category];

  const employeeIdParam = searchParams.get("employee") ?? "";
  const editNoteId = searchParams.get("edit") ?? "";
  const isEdit = !!editNoteId;
  const [selected, setSelected] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(todayISO());
  const [fieldValues, setFieldValues] = useState<string[]>(() =>
    Array(cfg.fields.length).fill(""),
  );
  const [checked, setChecked] = useState<boolean[]>(() =>
    Array(cfg.checkboxes.length).fill(false),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        // Edit mode: hydrate from saved note, then employee
        let employeeId = employeeIdParam;
        if (isEdit) {
          const noteSnap = await getDoc(doc(getDb(), "hr_notes", editNoteId));
          if (noteSnap.exists()) {
            const n = noteSnap.data() as {
              employeeUid: string;
              date?: string;
              fields?: Record<string, string>;
              checkboxes?: { label: string; checked: boolean }[];
            };
            employeeId = n.employeeUid;
            if (n.date) setDate(n.date);
            setFieldValues(
              cfg.fields.map((f) => n.fields?.[f.label] ?? ""),
            );
            setChecked(
              cfg.checkboxes.map((label) =>
                n.checkboxes?.find((c) => c.label === label)?.checked ?? false,
              ),
            );
          }
        }

        if (!employeeId) return;
        const snap = await getDoc(doc(getDb(), "staff_onboarding", employeeId));
        if (snap.exists()) {
          const d = snap.data() as StaffDoc;
          const { firstName, lastName } = displayName(d, employeeId);
          setSelected({
            id: employeeId,
            firstName,
            lastName,
            role: d.role === "manager" ? "Manager" : "Staff",
          });
        }
      } catch {
        /* keep selected null */
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeIdParam, editNoteId, isEdit]);

  const canSubmit =
    !saving &&
    !!date &&
    cfg.fields.every((f, i) => {
      if (f.optional) return true;
      if (f.kind === "photo") return true; // photo is always optional in this build
      return fieldValues[i].trim().length > 0;
    }) &&
    cfg.checkboxes.every((_, i) => checked[i]);

  function setField(idx: number, v: string) {
    const next = [...fieldValues];
    const field = cfg.fields[idx];
    // Photo fields hold a data URL — don't apply a character cap.
    if (field?.kind === "photo") {
      next[idx] = v;
    } else {
      const max = field?.maxLength ?? MAX_LEN;
      next[idx] = v.slice(0, max);
    }
    setFieldValues(next);
  }

  function toggleCheck(idx: number) {
    const next = [...checked];
    next[idx] = !next[idx];
    setChecked(next);
  }

  async function handleSave() {
    if (!canSubmit || !selected || !user) return;
    setSaving(true);
    try {
      // Build the field map from labels → values so detail pages can render
      // them under the same headings the form used.
      const fields: Record<string, string> = {};
      cfg.fields.forEach((f, i) => {
        fields[f.label] = fieldValues[i].trim();
      });
      const checkboxes = cfg.checkboxes.map((label, i) => ({
        label,
        checked: checked[i],
      }));

      const addedByName =
        emailToUsername(user.email ?? "").charAt(0).toUpperCase() +
        emailToUsername(user.email ?? "").slice(1);

      if (isEdit) {
        await updateDoc(doc(getDb(), "hr_notes", editNoteId), {
          date,
          fields,
          checkboxes,
        });
        router.push(`/people/hr-notes/${editNoteId}`);
      } else {
        await addDoc(collection(getDb(), "hr_notes"), {
          category,
          kind: cfg.title,
          employeeUid: selected.id,
          employeeName: `${selected.firstName} ${selected.lastName}`.trim(),
          employeeRole: selected.role,
          date,
          fields,
          checkboxes,
          addedByUid: user.uid,
          addedByName,
          createdAt: serverTimestamp(),
        });
        router.push("/people/hr-notes");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save.");
      setSaving(false);
    }
  }

  if (loading) return <Splash />;
  if (!selected) {
    return (
      <div className={styles.page}>
        <p>Employee not found.</p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <button
        type="button"
        className={styles.backBtn}
        onClick={() => router.push(isEdit ? `/people/hr-notes/${editNoteId}` : "/people/hr-notes/add")}
        aria-label="Back"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      <header className={styles.heading}>
        <span className={`${styles.heroIcon} ${styles[cfg.iconClass]}`} aria-hidden="true">
          {cfg.icon(28)}
        </span>
        <div className={styles.headingText}>
          <h1 className={styles.title}>{cfg.title}</h1>
          <p className={styles.subtitle}>{cfg.subtitle}</p>
        </div>
      </header>

      {/* Locked employee card */}
      <section className={styles.empCard}>
        <span className={styles.empAvatar} aria-hidden="true">
          {initials(selected.firstName, selected.lastName)}
        </span>
        <div className={styles.empBody}>
          <p className={styles.empName}>{selected.firstName} {selected.lastName}</p>
          <p className={styles.empRole}>{selected.role}</p>
          <p className={styles.empLocked}>
            Employee cannot be changed
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </p>
        </div>
      </section>

      {/* Date */}
      <section>
        <h2 className={styles.sectionTitle}>Date</h2>
        <div className={styles.dateWrap}>
          <span className={styles.dateIcon} aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </span>
          <input
            type="date"
            className={styles.dateInput}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <span className={styles.dateDisplay}>{fmtDate(date)}</span>
        </div>
      </section>

      {/* Per-category fields */}
      {cfg.fields.map((f, idx) => {
        const kind = f.kind ?? "textarea";
        const max = f.maxLength ?? (kind === "input" ? 100 : MAX_LEN);
        return (
          <section key={f.key}>
            <h2 className={styles.sectionTitle}>
              {f.label}
              {f.optional && <span className={styles.optional}> (Optional)</span>}
            </h2>
            {f.hint && <p className={styles.sectionSub}>{f.hint}</p>}

            {kind === "textarea" && (
              <div className={styles.textareaWrap}>
                <textarea
                  className={styles.textarea}
                  placeholder={f.placeholder}
                  value={fieldValues[idx]}
                  onChange={(e) => setField(idx, e.target.value)}
                  maxLength={max}
                  rows={5}
                />
                <span className={styles.counter}>{fieldValues[idx].length}/{max}</span>
              </div>
            )}

            {kind === "input" && (
              <div className={styles.textareaWrap}>
                <input
                  type="text"
                  className={styles.shortInput}
                  placeholder={f.placeholder}
                  value={fieldValues[idx]}
                  onChange={(e) => setField(idx, e.target.value)}
                  maxLength={max}
                />
                <span className={styles.counter}>{fieldValues[idx].length}/{max}</span>
              </div>
            )}

            {kind === "time" && (
              <div className={styles.timeWrap}>
                <span className={styles.timeIcon} aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </span>
                <input
                  type="time"
                  className={styles.timeInput}
                  value={fieldValues[idx] || ""}
                  onChange={(e) => setField(idx, e.target.value)}
                />
              </div>
            )}

            {kind === "photo" && (
              <>
                <label className={styles.photoBtn}>
                  <input
                    type="file"
                    accept="image/*"
                    className={styles.hiddenFile}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        // Compress so the data URL fits within Firestore's
                        // 1 MB per-document limit.
                        const compressed = await fileToCompressedDataUrl(file);
                        setField(idx, compressed);
                      } catch (err) {
                        alert(err instanceof Error ? err.message : "Could not process the image.");
                      } finally {
                        // Reset so picking the same file again still fires.
                        e.target.value = "";
                      }
                    }}
                  />
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                  <span>{fieldValues[idx] ? "Change Photo" : "Add Photo"}</span>
                </label>
                {fieldValues[idx]?.startsWith("data:image/") && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={fieldValues[idx]}
                    alt="Attached"
                    style={{
                      marginTop: "var(--space-2)",
                      width: "100%",
                      maxHeight: 280,
                      objectFit: "cover",
                      borderRadius: "var(--radius-md)",
                      border: "1px solid var(--color-border)",
                    }}
                  />
                )}
              </>
            )}
          </section>
        );
      })}

      {/* Checkboxes */}
      <ul className={styles.checkList}>
        {cfg.checkboxes.map((label, idx) => (
          <li key={label}>
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={checked[idx]}
                onChange={() => toggleCheck(idx)}
              />
              <span className={styles.checkLabel}>{label}</span>
            </label>
          </li>
        ))}
      </ul>

      <button
        type="button"
        className={styles.submitBtn}
        onClick={handleSave}
        disabled={!canSubmit}
      >
        {saving ? "Saving…" : cfg.submitLabel}
      </button>
    </div>
  );
}
