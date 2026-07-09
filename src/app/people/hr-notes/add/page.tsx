"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { collection, getDocs } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

/* ──────────────────────────────────────────────────────────────────────
 * Step 1 of the Add HR Note flow: pick the employee + the note category.
 * Employees come from staff_onboarding (owners excluded).
 * ──────────────────────────────────────────────────────────────────── */

type Member = {
  id: string;
  firstName: string;
  lastName: string;
  role: "Staff" | "Manager";
};

type StaffDoc = {
  uid: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  role?: string;
};

function displayName(d: StaffDoc): { firstName: string; lastName: string } {
  const f = (d.firstName ?? "").trim();
  const l = (d.lastName ?? "").trim();
  if (f || l) return { firstName: f, lastName: l };
  const u = (d.username ?? "").trim();
  if (u) return { firstName: u.charAt(0).toUpperCase() + u.slice(1), lastName: "" };
  return { firstName: d.uid.slice(0, 6), lastName: "" };
}

type CategoryKey = "warning" | "review" | "incident" | "other";

const CATEGORIES: {
  key: CategoryKey;
  label: string;
  description: string;
  iconClass: string;
}[] = [
  { key: "warning",  label: "Formal Warning",     description: "Record formal warnings and performance related issues.", iconClass: "kindWarning" },
  { key: "review",   label: "Performance Review", description: "Record performance reviews and feedback.",                iconClass: "kindReview" },
  { key: "incident", label: "Incident Report",    description: "Record incidents and workplace issues.",                  iconClass: "kindIncident" },
  { key: "other",    label: "Other",              description: "Record other important matters.",                          iconClass: "kindOther" },
];

function initials(first: string, last: string) {
  return ((first.charAt(0) || "?") + (last.charAt(0) || "")).toUpperCase();
}

function categoryIcon(key: CategoryKey, size = 22) {
  switch (key) {
    case "warning":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      );
    case "review":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      );
    case "incident":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2L4 6v6c0 5 3.5 9.5 8 10 4.5-.5 8-5 8-10V6l-8-4z" />
          <line x1="12" y1="8" x2="12" y2="13" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      );
    case "other":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="5" cy="12" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="19" cy="12" r="1.5" />
        </svg>
      );
  }
}

export default function AddHrNotePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const presetEmployeeId = searchParams?.get("employee") ?? "";
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [employeeId, setEmployeeId] = useState<string>("");
  const [empPickerOpen, setEmpPickerOpen] = useState(false);
  const [category, setCategory] = useState<CategoryKey | null>(null);

  // Load real staff from staff_onboarding (owners excluded).
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(getDb(), "staff_onboarding"));
        const list: Member[] = snap.docs
          .map((dSnap) => ({ uid: dSnap.id, ...(dSnap.data() as Omit<StaffDoc, "uid">) }))
          .filter((d) => d.role !== "owner")
          .map((d) => {
            const { firstName, lastName } = displayName(d);
            return {
              id: d.uid,
              firstName,
              lastName,
              role: d.role === "manager" ? "Manager" : "Staff",
            } as Member;
          })
          .sort((a, b) => a.firstName.localeCompare(b.firstName));
        setMembers(list);
        const preset =
          presetEmployeeId && list.some((m) => m.id === presetEmployeeId)
            ? presetEmployeeId
            : list[0]?.id ?? "";
        setEmployeeId(preset);
      } catch {
        /* leave empty */
      } finally {
        setLoading(false);
      }
    })();
  }, [presetEmployeeId]);

  const selected = useMemo(
    () => members.find((m) => m.id === employeeId) ?? members[0],
    [employeeId, members],
  );

  const canSubmit = Boolean(selected && category);

  function handleNext() {
    if (!canSubmit || !category) return;
    const params = new URLSearchParams({ employee: employeeId });
    router.push(`/people/hr-notes/add/${category}?${params.toString()}`);
  }

  if (loading) return <Splash />;

  return (
    <div className={styles.page}>
      <button
        type="button"
        className={styles.backBtn}
        onClick={() => router.push("/people/hr-notes")}
        aria-label="Back"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      <header className={styles.heading}>
        <h1 className={styles.title}>Add HR Note</h1>
        <p className={styles.subtitle}>Record important employee matters.</p>
      </header>

      {/* Employee */}
      <section>
        <h2 className={styles.sectionTitle}>Employee</h2>
        {selected ? (
          <div className={styles.empWrap}>
            <button
              type="button"
              className={styles.empSelect}
              onClick={() => setEmpPickerOpen((o) => !o)}
              aria-haspopup="listbox"
              aria-expanded={empPickerOpen}
            >
              <span className={styles.empAvatar} aria-hidden="true">
                {initials(selected.firstName, selected.lastName)}
              </span>
              <span className={styles.empNameWrap}>
                <span className={styles.empName}>
                  {selected.firstName} {selected.lastName}
                </span>
                <span className={styles.empRole}>{selected.role}</span>
              </span>
              <span className={`${styles.empChev} ${empPickerOpen ? styles.empChevOpen : ""}`} aria-hidden="true">▾</span>
            </button>
            {empPickerOpen && (
              <>
                <div className={styles.empBackdrop} onClick={() => setEmpPickerOpen(false)} />
                <ul className={styles.empMenu} role="listbox">
                  {members.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={m.id === employeeId}
                        className={`${styles.empOption} ${m.id === employeeId ? styles.empOptionActive : ""}`}
                        onClick={() => {
                          setEmployeeId(m.id);
                          setEmpPickerOpen(false);
                        }}
                      >
                        <span className={styles.empAvatarSm} aria-hidden="true">
                          {initials(m.firstName, m.lastName)}
                        </span>
                        <span className={styles.empNameWrap}>
                          <span className={styles.empName}>{m.firstName} {m.lastName}</span>
                          <span className={styles.empRole}>{m.role}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ) : (
          <p className={styles.emptyHint}>
            No staff registered yet. Create one from People → Staff +.
          </p>
        )}
      </section>

      {/* Category */}
      <section>
        <h2 className={styles.sectionTitle}>Category</h2>
        <p className={styles.sectionSub}>Select the type of note you want to add.</p>
        <ul className={styles.catList}>
          {CATEGORIES.map((c) => {
            const active = category === c.key;
            return (
              <li key={c.key}>
                <button
                  type="button"
                  className={`${styles.catRow} ${active ? styles.catRowActive : ""}`}
                  onClick={() => setCategory(c.key)}
                  aria-pressed={active}
                >
                  <span className={`${styles.catRadio} ${active ? styles.catRadioActive : ""}`} aria-hidden="true">
                    {active && <span className={styles.catRadioInner} />}
                  </span>
                  <span className={`${styles.catIcon} ${styles[c.iconClass]}`} aria-hidden="true">
                    {categoryIcon(c.key, 22)}
                  </span>
                  <span className={styles.catBody}>
                    <p className={styles.catLabel}>{c.label}</p>
                    <p className={styles.catDescription}>{c.description}</p>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <div className={styles.infoBox}>
        <span className={styles.infoIcon} aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </span>
        <div className={styles.infoBody}>
          <p className={styles.infoTitle}>Important records only</p>
          <p className={styles.infoSub}>
            Use this section for Formal Warning, Performance Review, Incident
            Report or Other.
          </p>
        </div>
      </div>

      <button
        type="button"
        className={styles.nextBtn}
        onClick={handleNext}
        disabled={!canSubmit}
      >
        <span>Next</span>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      </button>
    </div>
  );
}
