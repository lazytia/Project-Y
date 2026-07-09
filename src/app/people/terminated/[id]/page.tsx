"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { isOwner, isChef } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import {
  fmtDate,
  fmtDateWithDay,
  fmtDateWithDayFromTs,
  fullNameOf,
  initialsOf,
  positionLabelOf,
  reasonDisplayOf,
  tsToDate,
} from "@/lib/staff-display";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

type DocKey = "documents" | "tfn" | "bank" | "contract" | "handbook" | "hrNotes";

type BankSuper = {
  bsb?: string;
  accountNumber?: string;
  accountName?: string;
  superFundName?: string;
  usi?: string;
  memberNumber?: string;
};

type HrNote = { id: string; kind: string; body: string; date: string };

type TerminatedStaff = {
  uid: string;
  name: string;
  positionLabel: string;
  rate: number | null;
  startDate: Date | null;
  visaExpiry: Date | null;
  visaType: string;
  phone: string;
  taxFileNumber: string;
  signatureDataUrl: string;
  bank: BankSuper;
  handbookSignedAt: Date | null;
  agreementSignedAt: Date | null;
  privacySignedAt: Date | null;
  documents: { label: string; url: string }[];
  lastWorkingDate: string;
  terminatedAt: Date | null;
  noticeGivenDate: string;
  reason: string;
  rehireEligible: string;
  managerNotes: string;
  terminatedByName: string;
};

function visaTypeOf(raw: Record<string, unknown>): string {
  if (typeof raw.visaType === "string" && raw.visaType.trim()) return raw.visaType.trim();
  return "—";
}

function collectDocuments(raw: Record<string, unknown>): { label: string; url: string }[] {
  const docs = (raw.documents ?? {}) as Record<string, unknown>;
  const known = [
    { key: "passportUrl", label: "Passport" },
    { key: "visaUrl", label: "Visa" },
    { key: "rsaUrl", label: "RSA Certificate" },
  ];
  const out: { label: string; url: string }[] = [];
  for (const { key, label } of known) {
    const v = docs[key];
    if (typeof v === "string" && v) out.push({ label, url: v });
  }
  return out;
}

export default function TerminatedEmployeeDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwner(user) || isChef(user);

  const [staff, setStaff] = useState<TerminatedStaff | null>(null);
  const [hrNotes, setHrNotes] = useState<HrNote[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [openDoc, setOpenDoc] = useState<DocKey | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!allowed) router.replace(ROUTES.home);
  }, [allowed, authLoading, router]);

  useEffect(() => {
    if (!allowed) return;
    const id = params?.id;
    if (!id) return;
    let cancelled = false;

    (async () => {
      try {
        const snap = await getDoc(doc(getDb(), "staff_onboarding", id));
        if (!snap.exists()) {
          if (!cancelled) setNotFound(true);
          return;
        }
        const raw = snap.data() as Record<string, unknown>;
        if ((String(raw.status ?? "").toLowerCase()) !== "terminated") {
          router.replace(`/people/active/${id}`);
          return;
        }

        const rate =
          typeof raw.afterTrainingRate === "number"
            ? raw.afterTrainingRate
            : typeof raw.trainingRate === "number"
              ? raw.trainingRate
              : null;
        const policies = (raw.policies ?? {}) as Record<string, unknown>;
        const bank = (raw.bankSuper ?? {}) as BankSuper;
        const documents = (raw.documents ?? {}) as Record<string, unknown>;
        const tfnBlock = (raw.tfn ?? {}) as Record<string, unknown>;
        const tfnValue =
          (typeof tfnBlock.taxFileNumber === "string" ? tfnBlock.taxFileNumber : "") ||
          (typeof raw.taxFileNumber === "string" ? raw.taxFileNumber : "");

        const built: TerminatedStaff = {
          uid: snap.id,
          name: fullNameOf(raw),
          positionLabel: positionLabelOf(raw),
          rate,
          startDate: tsToDate(raw.startDate),
          visaExpiry: tsToDate(documents.visaExpiry ?? raw.visaExpiry ?? null),
          visaType: visaTypeOf(raw),
          phone: typeof raw.mobileNumber === "string" ? raw.mobileNumber : "",
          taxFileNumber: tfnValue,
          signatureDataUrl:
            typeof tfnBlock.signatureDataUrl === "string" ? tfnBlock.signatureDataUrl : "",
          bank,
          handbookSignedAt: tsToDate(policies.handbookSignedAt),
          agreementSignedAt: tsToDate(policies.agreementSignedAt),
          privacySignedAt: tsToDate(policies.privacySignedAt),
          documents: collectDocuments(raw),
          lastWorkingDate: typeof raw.lastWorkingDate === "string" ? raw.lastWorkingDate : "",
          terminatedAt: tsToDate(raw.terminatedAt),
          noticeGivenDate: typeof raw.noticeGivenDate === "string" ? raw.noticeGivenDate : "",
          reason: reasonDisplayOf(raw),
          rehireEligible: typeof raw.rehireEligible === "string" ? raw.rehireEligible : "—",
          managerNotes:
            typeof raw.terminationManagerNotes === "string"
              ? raw.terminationManagerNotes
              : typeof raw.managerNotes === "string"
                ? raw.managerNotes
                : "—",
          terminatedByName:
            typeof raw.terminatedByName === "string" ? raw.terminatedByName : "—",
        };

        if (!cancelled) setStaff(built);

        const notesSnap = await getDocs(
          query(collection(getDb(), "hr_notes"), where("employeeUid", "==", id)),
        );
        const notes: HrNote[] = notesSnap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          const fields = (data.fields ?? {}) as Record<string, string>;
          const body = fields.summary ?? fields.details ?? fields.note ?? "—";
          return {
            id: d.id,
            kind: String(data.kind ?? "Note"),
            body: String(body),
            date: String(data.date ?? ""),
          };
        });
        if (!cancelled) setHrNotes(notes);
      } catch {
        if (!cancelled) setNotFound(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [allowed, params?.id, router]);

  if (authLoading || !allowed) return <Splash />;
  if (notFound) {
    return (
      <div className={styles.page}>
        <TopBar onBack={() => router.back()} />
        <p className={styles.notFound}>This employee record no longer exists.</p>
      </div>
    );
  }
  if (!staff) return <Splash label="Loading…" />;

  const terminatedOn = staff.terminatedAt ? fmtDateWithDayFromTs(staff.terminatedAt) : "—";

  return (
    <div className={styles.page}>
      <TopBar onBack={() => router.back()} />

      <section className={styles.profileCard}>
        <div className={styles.profileTop}>
          <div className={styles.avatar}>{initialsOf(staff.name)}</div>
          <div className={styles.profileMain}>
            <h2 className={styles.profileName}>{staff.name}</h2>
            <p className={styles.profilePos}>{staff.positionLabel}</p>
            <span className={styles.terminatedPill}>
              <span className={styles.terminatedDot} aria-hidden="true" />
              Terminated
            </span>
          </div>
          <div className={styles.terminatedOn}>
            <p className={styles.terminatedOnLabel}>Terminated on</p>
            <p className={styles.terminatedOnDate}>{terminatedOn}</p>
          </div>
        </div>

        <div className={styles.profileDivider} aria-hidden="true" />
        <div className={styles.dateGrid}>
          <div className={styles.dateCol}>
            <CalendarIcon className={styles.dateIcon} />
            <div>
              <p className={styles.dateLabel}>LAST WORKING DAY</p>
              <p className={`${styles.dateValue} ${styles.dateValueAccent}`}>
                {fmtDateWithDay(staff.lastWorkingDate)}
              </p>
            </div>
          </div>
          <div className={styles.dateDivider} aria-hidden="true" />
          <div className={styles.dateCol}>
            <div>
              <p className={styles.dateLabel}>NOTICE GIVEN DATE</p>
              <p className={`${styles.dateValue} ${styles.dateValueMuted}`}>
                {fmtDateWithDay(staff.noticeGivenDate)}
              </p>
            </div>
          </div>
        </div>

        <div className={styles.profileDivider} aria-hidden="true" />
        <div className={styles.profileStats}>
          <div className={styles.statCell}>
            <p className={styles.statLabel}>Rate</p>
            <p className={`${styles.statValue} ${styles.statValueAccent}`}>
              {typeof staff.rate === "number" ? `$${staff.rate}/hr` : "—"}
            </p>
          </div>
          <div className={styles.statCell}>
            <p className={styles.statLabel}>Start Date</p>
            <p className={styles.statValue}>{fmtDate(staff.startDate)}</p>
          </div>
          <div className={styles.statCell}>
            <p className={styles.statLabel}>Visa Type</p>
            <p className={styles.statValue}>{staff.visaType}</p>
          </div>
          <div className={styles.statCell}>
            <p className={styles.statLabel}>Visa Expiry</p>
            <p className={styles.statValue}>{fmtDate(staff.visaExpiry)}</p>
          </div>
        </div>
      </section>

      {staff.phone && (
        <button
          type="button"
          className={styles.linkRow}
          onClick={() => window.open(`tel:${staff.phone.replace(/\s/g, "")}`, "_self")}
        >
          <PhoneIcon />
          <span className={styles.linkRowLabel}>Phone</span>
          <span className={styles.linkRowValue}>{staff.phone}</span>
          <span className={styles.chev} aria-hidden="true">›</span>
        </button>
      )}

      <p className={styles.sectionLabel}>TERMINATION SUMMARY</p>
      <section className={styles.infoCard}>
        <InfoRow label="Notice Given Date" value={fmtDateWithDay(staff.noticeGivenDate)} />
        <InfoRow label="Last Working Day" value={fmtDateWithDay(staff.lastWorkingDate)} accent />
        <InfoRow label="Reason for Leaving" value={staff.reason} />
        <InfoRow label="Rehire Eligible" value={staff.rehireEligible || "—"} />
        <InfoRow label="Manager Notes" value={staff.managerNotes || "—"} />
        <InfoRow label="Terminated By" value={staff.terminatedByName} />
        <InfoRow label="Termination Date" value={terminatedOn} accent last />
      </section>

      <p className={styles.sectionLabel}>DOCUMENTS</p>
      <section className={styles.docsCard}>
        <DocRow label="Documents" onClick={() => setOpenDoc("documents")} chev />
        <DocRow label="TFN" onClick={() => setOpenDoc("tfn")} view />
        <DocRow label="Bank & Super Details" onClick={() => setOpenDoc("bank")} view />
        <DocRow label="Signed Contract" onClick={() => setOpenDoc("contract")} view />
        <DocRow label="Employee Handbook (Signed)" onClick={() => setOpenDoc("handbook")} view />
        <DocRow
          label="HR Notes"
          onClick={() => setOpenDoc("hrNotes")}
          view
          last
        />
      </section>

      <p className={styles.sectionLabel}>CHANGE STATUS</p>
      <div className={styles.statusGrid}>
        <button
          type="button"
          className={styles.statusCard}
          onClick={() => router.push(`/people/terminated/${staff.uid}/reactivate`)}
        >
          <SearchIcon />
          <span className={styles.statusLabel}>Reactivate Employee</span>
        </button>
        <button
          type="button"
          className={styles.statusCard}
          onClick={() => router.push(`/people/hr-notes/add?employee=${staff.uid}`)}
        >
          <EditIcon />
          <span className={styles.statusLabel}>Add HR Note</span>
        </button>
      </div>

      {openDoc && (
        <DocModal
          docKey={openDoc}
          staff={staff}
          hrNotes={hrNotes}
          onClose={() => setOpenDoc(null)}
        />
      )}
    </div>
  );
}

function TopBar({ onBack }: { onBack: () => void }) {
  return (
    <div className={styles.topBar}>
      <button type="button" className={styles.iconBtn} onClick={onBack} aria-label="Back">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <h1 className={styles.topTitle}>Employee Details</h1>
      <span aria-hidden="true" style={{ width: 40 }} />
    </div>
  );
}

function InfoRow({
  label,
  value,
  accent = false,
  last = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
  last?: boolean;
}) {
  return (
    <div className={`${styles.infoRow} ${last ? styles.infoRowLast : ""}`}>
      <span className={styles.infoLabel}>{label}</span>
      <span className={`${styles.infoValue} ${accent ? styles.infoValueAccent : ""}`}>
        {value}
      </span>
    </div>
  );
}

function DocRow({
  label,
  onClick,
  view = false,
  chev = false,
  last = false,
}: {
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
      <DocIcon />
      <span className={styles.docRowLabel}>{label}</span>
      {view && <span className={styles.docRowView}>View</span>}
      {chev && <span className={styles.chev} aria-hidden="true">›</span>}
    </button>
  );
}

function DocModal({
  docKey,
  staff,
  hrNotes,
  onClose,
}: {
  docKey: DocKey;
  staff: TerminatedStaff;
  hrNotes: HrNote[];
  onClose: () => void;
}) {
  const titles: Record<DocKey, string> = {
    documents: "Documents",
    tfn: "Tax File Number",
    bank: "Bank & Super Details",
    contract: "Signed Contract",
    handbook: "Employee Handbook (Signed)",
    hrNotes: "HR Notes",
  };

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
          <h3 className={styles.modalTitle}>{titles[docKey]}</h3>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        {docKey === "documents" && (
          staff.documents.length === 0 ? (
            <p className={styles.modalHint}>No documents uploaded yet.</p>
          ) : (
            <ul className={styles.modalList}>
              {staff.documents.map((d) => (
                <li key={d.url} className={styles.modalListRow}>
                  <span>{d.label}</span>
                  <a className={styles.modalListLink} href={d.url} target="_blank" rel="noopener noreferrer">
                    Open ↗
                  </a>
                </li>
              ))}
            </ul>
          )
        )}
        {docKey === "tfn" && (
          <>
            <dl className={styles.modalDefs}>
              <div className={styles.modalDefRow}>
                <dt className={styles.modalDefLabel}>TFN</dt>
                <dd className={styles.modalDefValue}>{staff.taxFileNumber || "—"}</dd>
              </div>
            </dl>
            {staff.signatureDataUrl && (
              <div className={styles.signatureBlock}>
                <img src={staff.signatureDataUrl} alt="Signature" className={styles.signatureImg} />
              </div>
            )}
          </>
        )}
        {docKey === "bank" && (
          <dl className={styles.modalDefs}>
            <DefRow label="BSB" value={staff.bank.bsb} />
            <DefRow label="Account Number" value={staff.bank.accountNumber} />
            <DefRow label="Account Name" value={staff.bank.accountName} />
            <DefRow label="Super Fund" value={staff.bank.superFundName} />
            <DefRow label="USI" value={staff.bank.usi} />
            <DefRow label="Member Number" value={staff.bank.memberNumber} />
          </dl>
        )}
        {docKey === "contract" && (
          <>
            <dl className={styles.modalDefs}>
              <div className={styles.modalDefRow}>
                <dt className={styles.modalDefLabel}>Employment Agreement</dt>
                <dd className={styles.modalDefValue}>
                  {staff.agreementSignedAt ? `Signed ${fmtDate(staff.agreementSignedAt)}` : "Not signed"}
                </dd>
              </div>
            </dl>
            {staff.signatureDataUrl && (
              <div className={styles.signatureBlock}>
                <img src={staff.signatureDataUrl} alt="Signature" className={styles.signatureImg} />
              </div>
            )}
          </>
        )}
        {docKey === "handbook" && (
          <dl className={styles.modalDefs}>
            <div className={styles.modalDefRow}>
              <dt className={styles.modalDefLabel}>Acknowledged On</dt>
              <dd className={styles.modalDefValue}>
                {staff.handbookSignedAt ? fmtDate(staff.handbookSignedAt) : "Not signed"}
              </dd>
            </div>
          </dl>
        )}
        {docKey === "hrNotes" && (
          hrNotes.length === 0 ? (
            <p className={styles.modalHint}>No HR notes on file.</p>
          ) : (
            <ul className={styles.modalList}>
              {hrNotes.map((n) => (
                <li key={n.id} className={styles.modalListRow}>
                  <span>{n.kind}</span>
                  <span>{n.body}</span>
                </li>
              ))}
            </ul>
          )
        )}
      </div>
    </div>
  );
}

function DefRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className={styles.modalDefRow}>
      <dt className={styles.modalDefLabel}>{label}</dt>
      <dd className={styles.modalDefValue}>{value?.trim() || "—"}</dd>
    </div>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.linkRowIcon} aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.docRowIcon} aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
