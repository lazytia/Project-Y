"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { isOwner, isChef } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import Splash from "@/components/Splash";
import { getMockActiveStaff, type MockActiveStaff } from "@/lib/mock-active-staff";
import styles from "./page.module.css";

type DocKey = "documents" | "tfn" | "bank" | "contract" | "handbook" | "hrNotes";

const VISA_WINDOW_DAYS = 30;

function daysFromToday(d: Date | null): number | null {
  if (!d) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 86_400_000);
}

function fmtLongDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function fmtRelDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export default function EmployeeDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwner(user) || isChef(user);

  const [openDoc, setOpenDoc] = useState<DocKey | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!allowed) router.replace(ROUTES.home);
  }, [allowed, authLoading, router]);

  const staff: MockActiveStaff | null = useMemo(() => {
    const id = params?.id;
    if (!id) return null;
    return getMockActiveStaff().find((s) => s.uid === id) ?? null;
  }, [params?.id]);

  // Lock body scroll while a modal is open.
  useEffect(() => {
    if (!openDoc) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [openDoc]);

  useEffect(() => {
    if (!openDoc) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenDoc(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openDoc]);

  if (authLoading || !allowed) return <Splash />;

  if (!staff) {
    return (
      <div className={styles.page}>
        <TopBar onBack={() => router.back()} />
        <p className={styles.notFound}>This employee record no longer exists.</p>
      </div>
    );
  }

  const visaDays = daysFromToday(staff.visaExpiry);
  const visaWarn = visaDays !== null && visaDays >= 0 && visaDays <= VISA_WINDOW_DAYS;

  return (
    <div className={styles.page}>
      <TopBar onBack={() => router.back()} />

      {/* Profile card */}
      <section className={styles.profileCard}>
        <div className={styles.profileTop}>
          <div className={styles.avatarWrap} aria-hidden="true">
            <div className={styles.avatar}>{initialsOf(staff.name)}</div>
            <span className={styles.avatarDot} />
          </div>
          <div className={styles.profileMain}>
            <h2 className={styles.profileName}>{staff.name}</h2>
            <p className={styles.profilePos}>{`${staff.positionLabel} Staff`}</p>
            <span className={styles.activePill}>Active</span>
          </div>
        </div>
        <div className={styles.profileDivider} aria-hidden="true" />
        <div className={styles.profileStats}>
          <StatCell label="Rate" value={typeof staff.rate === "number" ? `$${staff.rate}/hr` : "—"} accent />
          <StatCell label="Start Date" value={fmtLongDate(staff.startDate)} />
          <StatCell label="Visa Type" value={staff.visaType} />
          <StatCell
            label="Visa Expiry"
            value={visaWarn ? `${visaDays} days` : fmtLongDate(staff.visaExpiry)}
            valueSub={visaWarn ? fmtLongDate(staff.visaExpiry) : undefined}
            accent={visaWarn}
            warn={visaWarn}
          />
        </div>
      </section>

      {/* Phone row */}
      <button
        type="button"
        className={styles.linkRow}
        onClick={() => window.open(`tel:${staff.phone.replace(/\s/g, "")}`, "_self")}
      >
        <span className={styles.linkRowIcon} aria-hidden="true"><PhoneIcon /></span>
        <span className={styles.linkRowLabel}>Phone</span>
        <span className={styles.linkRowValue}>{staff.phone}</span>
        <span className={styles.chev} aria-hidden="true">›</span>
      </button>

      {/* Documents */}
      <p className={styles.sectionLabel}>DOCUMENTS</p>
      <section className={styles.docsCard}>
        <DocRow icon={<DocIcon />} label="Documents" onClick={() => setOpenDoc("documents")} chev />
        <DocRow icon={<DocIcon />} label="TFN" onClick={() => setOpenDoc("tfn")} view />
        <DocRow icon={<DocIcon />} label="Bank & Super Details" onClick={() => setOpenDoc("bank")} view />
        <DocRow icon={<DocIcon />} label="Signed Contract" onClick={() => setOpenDoc("contract")} view />
        <DocRow icon={<DocIcon />} label="Employee Handbook (Signed)" onClick={() => setOpenDoc("handbook")} view />
        <DocRow icon={<DocIcon />} label="HR Notes" onClick={() => setOpenDoc("hrNotes")} view last />
      </section>

      {/* Change status */}
      <p className={styles.sectionLabel}>CHANGE STATUS</p>
      <div className={styles.statusGrid}>
        <button
          type="button"
          className={styles.statusCard}
          onClick={() => router.push("/people/notice-given/new")}
        >
          <CalendarIcon />
          <span className={styles.statusLabel}>Notice Given</span>
        </button>
        <button
          type="button"
          className={styles.statusCard}
          onClick={() => router.push("/people/terminated")}
        >
          <StopIcon />
          <span className={styles.statusLabel}>Terminated</span>
        </button>
      </div>

      {openDoc && (
        <DocModal
          docKey={openDoc}
          staff={staff}
          onClose={() => setOpenDoc(null)}
        />
      )}
    </div>
  );
}

/* ── Subcomponents ── */

function TopBar({ onBack }: { onBack: () => void }) {
  return (
    <div className={styles.topBar}>
      <button type="button" className={styles.iconBtn} onClick={onBack} aria-label="Back">
        <ChevronLeft />
      </button>
      <h1 className={styles.topTitle}>Employee Details</h1>
      <button type="button" className={styles.iconBtn} aria-label="More">
        <DotsIcon />
      </button>
    </div>
  );
}

function StatCell({
  label,
  value,
  valueSub,
  accent = false,
  warn = false,
}: {
  label: string;
  value: string;
  valueSub?: string;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <div className={styles.statCell}>
      <p className={styles.statLabel}>{label}</p>
      <p className={`${styles.statValue} ${accent ? styles.statValueAccent : ""}`}>
        {value}
        {warn && <span className={styles.warnDot} aria-hidden="true">!</span>}
      </p>
      {valueSub && <p className={styles.statValueSub}>{valueSub}</p>}
    </div>
  );
}

function DocRow({
  icon,
  label,
  onClick,
  view = false,
  chev = false,
  last = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  view?: boolean;
  chev?: boolean;
  last?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${styles.docRow} ${last ? styles.docRowLast : ""}`}
    >
      <span className={styles.docRowIcon} aria-hidden="true">{icon}</span>
      <span className={styles.docRowLabel}>{label}</span>
      {view && <span className={styles.docRowView}>View</span>}
      {chev && <span className={styles.chev} aria-hidden="true">›</span>}
    </button>
  );
}

/* ── Modal ── */

function DocModal({
  docKey,
  staff,
  onClose,
}: {
  docKey: DocKey;
  staff: MockActiveStaff;
  onClose: () => void;
}) {
  const { title, body } = renderModalBody(docKey, staff);
  return (
    <div
      className={styles.modalBackdrop}
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>{title}</h3>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        <div className={styles.modalBody}>{body}</div>
      </div>
    </div>
  );
}

function renderModalBody(docKey: DocKey, staff: MockActiveStaff): { title: string; body: React.ReactNode } {
  const d = staff.documents;
  switch (docKey) {
    case "documents":
      return {
        title: "Documents",
        body: (
          <ul className={styles.modalList}>
            {d.uploaded.map((f) => (
              <li key={f.label} className={styles.modalListRow}>
                <span className={styles.modalListName}>{f.label}</span>
                <span className={styles.modalListMeta}>
                  {fmtRelDate(f.uploadedOn)} · {f.sizeKb} KB
                </span>
              </li>
            ))}
          </ul>
        ),
      };
    case "tfn":
      return {
        title: "Tax File Number",
        body: (
          <dl className={styles.modalDefs}>
            <div className={styles.modalDefRow}>
              <dt className={styles.modalDefLabel}>TFN</dt>
              <dd className={styles.modalDefValue}>{d.tfn}</dd>
            </div>
            <div className={styles.modalDefRow}>
              <dt className={styles.modalDefLabel}>Submitted</dt>
              <dd className={styles.modalDefValue}>{fmtRelDate(staff.startDate)}</dd>
            </div>
            <p className={styles.modalHint}>
              Submitted by {staff.name} during onboarding. Visible to owner and manager only.
            </p>
          </dl>
        ),
      };
    case "bank":
      return {
        title: "Bank & Super Details",
        body: (
          <dl className={styles.modalDefs}>
            <div className={styles.modalDefRow}>
              <dt className={styles.modalDefLabel}>BSB</dt>
              <dd className={styles.modalDefValue}>{d.bank.bsb}</dd>
            </div>
            <div className={styles.modalDefRow}>
              <dt className={styles.modalDefLabel}>Account Number</dt>
              <dd className={styles.modalDefValue}>{d.bank.accountNumber}</dd>
            </div>
            <div className={styles.modalDefRow}>
              <dt className={styles.modalDefLabel}>Super Fund</dt>
              <dd className={styles.modalDefValue}>{d.bank.superFund}</dd>
            </div>
            <div className={styles.modalDefRow}>
              <dt className={styles.modalDefLabel}>Member Number</dt>
              <dd className={styles.modalDefValue}>{d.bank.memberNumber}</dd>
            </div>
          </dl>
        ),
      };
    case "contract":
      return {
        title: "Signed Contract",
        body: (
          <dl className={styles.modalDefs}>
            <div className={styles.modalDefRow}>
              <dt className={styles.modalDefLabel}>Signed On</dt>
              <dd className={styles.modalDefValue}>{fmtRelDate(d.contract.signedOn)}</dd>
            </div>
            <div className={styles.modalDefRow}>
              <dt className={styles.modalDefLabel}>Version</dt>
              <dd className={styles.modalDefValue}>{d.contract.version}</dd>
            </div>
            <p className={styles.modalHint}>Digital signature captured during onboarding.</p>
          </dl>
        ),
      };
    case "handbook":
      return {
        title: "Employee Handbook (Signed)",
        body: (
          <dl className={styles.modalDefs}>
            <div className={styles.modalDefRow}>
              <dt className={styles.modalDefLabel}>Acknowledged On</dt>
              <dd className={styles.modalDefValue}>{fmtRelDate(d.handbook.acknowledgedOn)}</dd>
            </div>
            <p className={styles.modalHint}>
              {staff.name} confirmed they have read and understood the Yurica staff handbook.
            </p>
          </dl>
        ),
      };
    case "hrNotes":
      return {
        title: "HR Notes",
        body:
          d.hrNotes.length === 0 ? (
            <p className={styles.modalHint}>No HR notes recorded for this employee.</p>
          ) : (
            <ul className={styles.modalList}>
              {d.hrNotes.map((n, i) => (
                <li key={i} className={styles.modalNoteRow}>
                  <div className={styles.modalNoteHead}>
                    <span className={styles.modalNoteAuthor}>{n.author}</span>
                    <span className={styles.modalNoteDate}>{fmtRelDate(n.date)}</span>
                  </div>
                  <p className={styles.modalNoteBody}>{n.note}</p>
                </li>
              ))}
            </ul>
          ),
      };
  }
}

/* ── Icons ── */

function ChevronLeft() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
