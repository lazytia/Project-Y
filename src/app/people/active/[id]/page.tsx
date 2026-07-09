"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  type Timestamp,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { isOwner, isChef } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
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

type StoredHrNote = {
  employeeUid?: string;
  category?: string;
  kind?: string;
  date?: string;
  fields?: Record<string, string>;
  checkboxes?: { label: string; checked: boolean }[];
  addedByName?: string;
  createdAt?: Timestamp;
};

type HrNote = {
  id: string;
  kind: string;
  category: string;
  date: string;
  body: string;
  addedBy: string;
};

type ActiveNotice = {
  id: string;
  noticeGivenDate: string;
  lastWorkingDay: string;
  reasonForLeaving: string;
  reasonForLeavingOther: string;
  rehireEligible: string;
  managerNotes: string;
};

type Staff = {
  uid: string;
  name: string;
  positionLabel: string;
  rate: number | null;
  startDate: Date | null;
  visaExpiry: Date | null;
  visaType: string;
  phone: string;
  taxFileNumber: string;
  /** Data-URL of the signature captured during the TFN declaration step.
   *  We reuse it across the Contract, Handbook, and TFN modals — it's the
   *  only signature the onboarding flow records today. */
  signatureDataUrl: string;
  bank: BankSuper;
  handbookSignedAt: Date | null;
  agreementSignedAt: Date | null;
  privacySignedAt: Date | null;
  documents: { label: string; url: string }[];
};

const VISA_WINDOW_DAYS = 30;

function tsToDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "string") {
    const [y, m, d] = v.split("-").map(Number);
    if (y && m && d) return new Date(y, m - 1, d, 12);
    const parsed = new Date(v);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof v === "object" && v !== null && "toDate" in v) {
    try {
      return (v as Timestamp).toDate();
    } catch {
      return null;
    }
  }
  return null;
}

function daysFromToday(d: Date | null): number | null {
  if (!d) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 86_400_000);
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

/** "25 Jul 2026 (Fri)" — used inside the notice information rows so the
 *  owner can double-check the day of the week without a mental map. */
function fmtDateWithDay(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  const main = date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  const dow = date.toLocaleDateString("en-AU", { weekday: "short" });
  return `${main} (${dow})`;
}

function daysBetween(fromISO: string): number | null {
  if (!fromISO) return null;
  const [y, m, d] = fromISO.split("-").map(Number);
  if (!y || !m || !d) return null;
  const target = new Date(y, m - 1, d);
  target.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 86_400_000);
}

function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function positionLabelOf(raw: Record<string, unknown>): string {
  const p = String(raw.position ?? "").trim().toLowerCase();
  const role = String(raw.role ?? "").toLowerCase();
  if (role === "chef" || p.includes("kitchen")) return "Kitchen Staff";
  if (p.includes("hall") || role === "manager") return "Hall Staff";
  const pos = String(raw.position ?? "").trim();
  return pos || "Staff";
}

function fullNameOf(raw: Record<string, unknown>): string {
  const fn = typeof raw.fullName === "string" ? raw.fullName.trim() : "";
  if (fn) return fn;
  const f = typeof raw.firstName === "string" ? raw.firstName.trim() : "";
  const l = typeof raw.lastName === "string" ? raw.lastName.trim() : "";
  if (f || l) return [f, l].filter(Boolean).join(" ");
  const email = typeof raw.email === "string" ? raw.email : "";
  const at = email.indexOf("@");
  const user = at === -1 ? email : email.slice(0, at);
  return user ? user.charAt(0).toUpperCase() + user.slice(1) : "Unknown";
}

/** Best effort — the visa type isn't captured explicitly today, so infer
 *  it from a `visaType` field if present and otherwise leave blank. */
function visaTypeOf(raw: Record<string, unknown>): string {
  if (typeof raw.visaType === "string" && raw.visaType.trim()) return raw.visaType.trim();
  if (typeof raw.visa === "string" && raw.visa.trim()) return raw.visa.trim();
  return "—";
}

/** Read the handful of URL fields we know onboarding writes. */
function collectDocuments(raw: Record<string, unknown>): { label: string; url: string }[] {
  const docs = (raw.documents ?? {}) as Record<string, unknown>;
  const known: { key: string; label: string }[] = [
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

export default function EmployeeDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwner(user) || isChef(user);

  const [staff, setStaff] = useState<Staff | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [hrNotes, setHrNotes] = useState<HrNote[]>([]);
  const [notice, setNotice] = useState<ActiveNotice | null>(null);
  const [cancellingNotice, setCancellingNotice] = useState(false);
  const [openDoc, setOpenDoc] = useState<DocKey | null>(null);
  const [terminateOpen, setTerminateOpen] = useState(false);
  const [terminating, setTerminating] = useState(false);

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

        const rate =
          typeof raw.afterTrainingRate === "number"
            ? raw.afterTrainingRate
            : typeof raw.trainingRate === "number"
              ? raw.trainingRate
              : null;

        const policies = (raw.policies ?? {}) as Record<string, unknown>;
        const bank = (raw.bankSuper ?? {}) as BankSuper;
        const documents = (raw.documents ?? {}) as Record<string, unknown>;
        // TFN declaration nests the actual TFN + signature under `tfn` —
        // the top-level field only exists on very old rows, so fall back
        // to it for completeness.
        const tfnBlock = (raw.tfn ?? {}) as Record<string, unknown>;
        const tfnValue =
          (typeof tfnBlock.taxFileNumber === "string" ? tfnBlock.taxFileNumber : "") ||
          (typeof raw.taxFileNumber === "string" ? raw.taxFileNumber : "");
        const signatureDataUrl =
          typeof tfnBlock.signatureDataUrl === "string" ? tfnBlock.signatureDataUrl : "";

        const built: Staff = {
          uid: snap.id,
          name: fullNameOf(raw),
          positionLabel: positionLabelOf(raw),
          rate,
          startDate: tsToDate(raw.startDate),
          visaExpiry: tsToDate(documents.visaExpiry ?? raw.visaExpiry ?? null),
          visaType: visaTypeOf(raw),
          phone: typeof raw.mobileNumber === "string" ? raw.mobileNumber : "",
          taxFileNumber: tfnValue,
          signatureDataUrl,
          bank,
          handbookSignedAt: tsToDate(policies.handbookSignedAt),
          agreementSignedAt: tsToDate(policies.agreementSignedAt),
          privacySignedAt: tsToDate(policies.privacySignedAt),
          documents: collectDocuments(raw),
        };

        if (!cancelled) setStaff(built);

        // Notice given — one active row per employee (they only appear on
        // Active while the notice is open, so we take the most recent).
        try {
          const noticeSnap = await getDocs(
            query(collection(getDb(), "notice_given"), where("employeeUid", "==", id)),
          );
          const notices = noticeSnap.docs
            .map((d) => {
              const data = d.data() as Record<string, unknown>;
              // The form calls the field "Final Shift Date" and persists it
              // as `finalShiftDate` — that's the real "last working day"
              // for the countdown. Older rows may only carry the legacy
              // `lastWorkingDay` string, so fall back to it if needed.
              const finalShift = typeof data.finalShiftDate === "string" ? data.finalShiftDate : "";
              const legacyLast = typeof data.lastWorkingDay === "string" ? data.lastWorkingDay : "";
              return {
                id: d.id,
                noticeGivenDate: typeof data.noticeGivenDate === "string" ? data.noticeGivenDate : "",
                lastWorkingDay: finalShift || legacyLast,
                reasonForLeaving: typeof data.reasonForLeaving === "string" ? data.reasonForLeaving : "",
                reasonForLeavingOther: typeof data.reasonForLeavingOther === "string" ? data.reasonForLeavingOther : "",
                rehireEligible: typeof data.rehireEligible === "string" ? data.rehireEligible : "",
                managerNotes: typeof data.managerNotes === "string" ? data.managerNotes : "",
              } satisfies ActiveNotice;
            })
            // Newest first — the most recent notice is authoritative.
            .sort((a, b) => (b.noticeGivenDate || "").localeCompare(a.noticeGivenDate || ""));
          if (!cancelled) setNotice(notices[0] ?? null);
        } catch {
          /* leave notice null */
        }

        // HR notes are stored top-level, keyed by employeeUid.
        try {
          const notesSnap = await getDocs(
            query(collection(getDb(), "hr_notes"), where("employeeUid", "==", id)),
          );
          const notes: HrNote[] = notesSnap.docs.map((d) => {
            const data = d.data() as StoredHrNote;
            const fields = data.fields ?? {};
            const body = fields.summary ?? fields.details ?? fields.note ?? Object.values(fields).join(" · ");
            return {
              id: d.id,
              kind: data.kind ?? "Note",
              category: data.category ?? "",
              date: data.date ?? "",
              body: body ?? "",
              addedBy: data.addedByName ?? "",
            };
          });
          notes.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
          if (!cancelled) setHrNotes(notes);
        } catch {
          /* leave notes empty */
        }
      } catch {
        if (!cancelled) setNotFound(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [allowed, params?.id]);

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

  const visaDays = useMemo(() => daysFromToday(staff?.visaExpiry ?? null), [staff]);
  const noticeDaysRemaining = useMemo(
    () => (notice ? daysBetween(notice.lastWorkingDay) : null),
    [notice],
  );

  async function handleConfirmTermination(lastDayISO: string) {
    if (!staff || terminating) return;
    setTerminating(true);
    try {
      // 1) Flip the staff doc into a terminated state so it drops off
      //    the active roster and lands on /people/terminated.
      await setDoc(
        doc(getDb(), "staff_onboarding", staff.uid),
        {
          status: "terminated",
          terminatedAt: serverTimestamp(),
          lastWorkingDate: lastDayISO,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      // 2) Any open notice_given rows belong to the pre-termination
      //    flow — sweep them so the terminated list isn't cluttered
      //    with countdowns that no longer apply.
      const noticeSnap = await getDocs(
        query(collection(getDb(), "notice_given"), where("employeeUid", "==", staff.uid)),
      );
      if (!noticeSnap.empty) {
        const batch = writeBatch(getDb());
        noticeSnap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
      setTerminateOpen(false);
      router.push("/people/active");
    } catch (err) {
      console.error("[terminate] failed:", err);
      alert("Failed to terminate. Please try again.");
      setTerminating(false);
    }
  }

  async function handleCancelNotice() {
    if (!notice || cancellingNotice) return;
    const ok = window.confirm(
      "Cancel this notice? The employee will move back to Active status.",
    );
    if (!ok) return;
    setCancellingNotice(true);
    try {
      await deleteDoc(doc(getDb(), "notice_given", notice.id));
      setNotice(null);
    } catch (err) {
      console.error("[notice-given] cancel failed:", err);
      alert("Failed to cancel notice. Please try again.");
    } finally {
      setCancellingNotice(false);
    }
  }

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

  const visaWarn = visaDays !== null && visaDays >= 0 && visaDays <= VISA_WINDOW_DAYS;
  const hasNotice = notice !== null;
  const reasonDisplay =
    notice?.reasonForLeaving === "Other" && notice.reasonForLeavingOther
      ? `Other — ${notice.reasonForLeavingOther}`
      : notice?.reasonForLeaving || "—";

  return (
    <div className={styles.page}>
      <TopBar onBack={() => router.back()} />

      {/* Profile card — orange notice-mode variant when the employee has
          an active notice_given row. */}
      <section className={`${styles.profileCard} ${hasNotice ? styles.profileCardNotice : ""}`}>
        <div className={styles.profileTop}>
          <div className={styles.avatarWrap} aria-hidden="true">
            <div className={styles.avatar}>{initialsOf(staff.name)}</div>
            <span className={`${styles.avatarDot} ${hasNotice ? styles.avatarDotNotice : ""}`} />
          </div>
          <div className={styles.profileMain}>
            <h2 className={styles.profileName}>{staff.name}</h2>
            <p className={styles.profilePos}>{staff.positionLabel}</p>
            {hasNotice ? (
              <span className={styles.noticePill}>Notice Given</span>
            ) : (
              <span className={styles.activePill}>Active</span>
            )}
          </div>
          {hasNotice && noticeDaysRemaining !== null && noticeDaysRemaining >= 0 && (
            <div className={styles.noticeCountdown} aria-label="Days remaining">
              <span className={styles.noticeCountdownIcon} aria-hidden="true"><ClockIcon /></span>
              <div className={styles.noticeCountdownText}>
                <p className={styles.noticeCountdownDays}>{noticeDaysRemaining} days</p>
                <p className={styles.noticeCountdownSub}>remaining</p>
              </div>
            </div>
          )}
        </div>

        {hasNotice && notice && (
          <>
            <div className={styles.profileDivider} aria-hidden="true" />
            <div className={styles.noticeDateGrid}>
              <div className={styles.noticeDateCol}>
                <span className={styles.noticeDateIcon} aria-hidden="true"><CalendarMiniIcon /></span>
                <div>
                  <p className={styles.noticeDateLabel}>LAST WORKING DAY</p>
                  <p className={styles.noticeDateValue}>{fmtDateWithDay(notice.lastWorkingDay)}</p>
                </div>
              </div>
              <div className={styles.noticeDateDivider} aria-hidden="true" />
              <div className={styles.noticeDateCol}>
                <div>
                  <p className={styles.noticeDateLabel}>NOTICE GIVEN DATE</p>
                  <p className={styles.noticeDateValueMuted}>{fmtDateWithDay(notice.noticeGivenDate)}</p>
                </div>
              </div>
            </div>
          </>
        )}

        <div className={styles.profileDivider} aria-hidden="true" />
        <div className={styles.profileStats}>
          <StatCell label="Rate" value={typeof staff.rate === "number" ? `$${staff.rate}/hr` : "—"} accent />
          <StatCell label="Start Date" value={fmtDate(staff.startDate)} />
          <StatCell label="Visa Type" value={staff.visaType} />
          <StatCell
            label="Visa Expiry"
            value={visaWarn ? `${visaDays} days` : fmtDate(staff.visaExpiry)}
            valueSub={visaWarn ? fmtDate(staff.visaExpiry) : undefined}
            accent={visaWarn}
            warn={visaWarn}
          />
        </div>
      </section>

      {/* Phone row */}
      {staff.phone && (
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
      )}

      {/* Notice information — only when the employee is under notice. */}
      {hasNotice && notice && (
        <>
          <p className={styles.sectionLabel}>NOTICE INFORMATION</p>
          <section className={styles.noticeInfoCard}>
            <InfoRow label="Notice Given Date" value={fmtDateWithDay(notice.noticeGivenDate)} />
            <InfoRow label="Last Working Day" value={fmtDateWithDay(notice.lastWorkingDay)} accent />
            <InfoRow label="Reason for Leaving" value={reasonDisplay} />
            <InfoRow label="Rehire Eligible" value={notice.rehireEligible || "—"} />
            <InfoRow label="Manager Notes" value={notice.managerNotes || "—"} last />
          </section>
        </>
      )}

      {/* Documents */}
      <p className={styles.sectionLabel}>DOCUMENTS</p>
      <section className={styles.docsCard}>
        <DocRow icon={<DocIcon />} label="Documents" onClick={() => setOpenDoc("documents")} chev />
        <DocRow icon={<DocIcon />} label="TFN" onClick={() => setOpenDoc("tfn")} view />
        <DocRow icon={<DocIcon />} label="Bank & Super Details" onClick={() => setOpenDoc("bank")} view />
        <DocRow icon={<DocIcon />} label="Signed Contract" onClick={() => setOpenDoc("contract")} view />
        <DocRow icon={<DocIcon />} label="Employee Handbook (Signed)" onClick={() => setOpenDoc("handbook")} view />
        <DocRow
          icon={<DocIcon />}
          label="HR Notes"
          onClick={() =>
            router.push(`/people/hr-notes?search=${encodeURIComponent(staff.name)}`)
          }
          view
          last
        />
      </section>

      {/* Change status */}
      <p className={styles.sectionLabel}>CHANGE STATUS</p>
      <div className={hasNotice ? styles.statusGrid : styles.statusGridSingle}>
        {hasNotice ? (
          <>
            <button
              type="button"
              className={styles.statusCard}
              onClick={handleCancelNotice}
              disabled={cancellingNotice}
            >
              <EditIcon />
              <span className={styles.statusLabel}>
                {cancellingNotice ? "Cancelling…" : "Cancel Notice"}
              </span>
            </button>
            <button
              type="button"
              className={styles.statusCard}
              onClick={() => setTerminateOpen(true)}
            >
              <StopIcon />
              <span className={styles.statusLabel}>Terminate Employee</span>
            </button>
          </>
        ) : (
          <button
            type="button"
            className={styles.statusCard}
            onClick={() => setTerminateOpen(true)}
          >
            <StopIcon />
            <span className={styles.statusLabel}>Terminated</span>
          </button>
        )}
      </div>

      {openDoc && (
        <DocModal
          docKey={openDoc}
          staff={staff}
          hrNotes={hrNotes}
          onClose={() => setOpenDoc(null)}
        />
      )}

      {terminateOpen && (
        <TerminateModal
          staff={staff}
          defaultDate={notice?.lastWorkingDay || ""}
          submitting={terminating}
          onClose={() => (terminating ? undefined : setTerminateOpen(false))}
          onConfirm={handleConfirmTermination}
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

function DocModal({
  docKey,
  staff,
  hrNotes,
  onClose,
}: {
  docKey: DocKey;
  staff: Staff;
  hrNotes: HrNote[];
  onClose: () => void;
}) {
  const { title, body } = renderModalBody(docKey, staff, hrNotes);
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

function renderModalBody(
  docKey: DocKey,
  staff: Staff,
  hrNotes: HrNote[],
): { title: string; body: React.ReactNode } {
  switch (docKey) {
    case "documents":
      return {
        title: "Documents",
        body:
          staff.documents.length === 0 ? (
            <p className={styles.modalHint}>No documents uploaded yet.</p>
          ) : (
            <ul className={styles.modalList}>
              {staff.documents.map((d) => (
                <li key={d.url} className={styles.modalListRow}>
                  <span className={styles.modalListName}>{d.label}</span>
                  <a
                    className={styles.modalListLink}
                    href={d.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open ↗
                  </a>
                </li>
              ))}
            </ul>
          ),
      };
    case "tfn":
      return {
        title: "Tax File Number",
        body: (
          <>
            <dl className={styles.modalDefs}>
              <div className={styles.modalDefRow}>
                <dt className={styles.modalDefLabel}>TFN</dt>
                <dd className={styles.modalDefValue}>{staff.taxFileNumber || "—"}</dd>
              </div>
            </dl>
            {staff.signatureDataUrl && (
              <SignatureBlock label="Signed by" name={staff.name} src={staff.signatureDataUrl} />
            )}
            <p className={styles.modalHint}>
              Submitted during onboarding. Visible to owner and manager only.
            </p>
          </>
        ),
      };
    case "bank":
      return {
        title: "Bank & Super Details",
        body: (
          <dl className={styles.modalDefs}>
            <DefRow label="BSB" value={staff.bank.bsb} />
            <DefRow label="Account Number" value={staff.bank.accountNumber} />
            <DefRow label="Account Name" value={staff.bank.accountName} />
            <DefRow label="Super Fund" value={staff.bank.superFundName} />
            <DefRow label="USI" value={staff.bank.usi} />
            <DefRow label="Member Number" value={staff.bank.memberNumber} />
          </dl>
        ),
      };
    case "contract":
      return {
        title: "Signed Contract",
        body: (
          <>
            <dl className={styles.modalDefs}>
              <div className={styles.modalDefRow}>
                <dt className={styles.modalDefLabel}>Employment Agreement</dt>
                <dd className={styles.modalDefValue}>
                  {staff.agreementSignedAt ? `Signed ${fmtDate(staff.agreementSignedAt)}` : "Not signed"}
                </dd>
              </div>
              <div className={styles.modalDefRow}>
                <dt className={styles.modalDefLabel}>Privacy Policy</dt>
                <dd className={styles.modalDefValue}>
                  {staff.privacySignedAt ? `Signed ${fmtDate(staff.privacySignedAt)}` : "Not signed"}
                </dd>
              </div>
            </dl>
            {staff.signatureDataUrl && (
              <SignatureBlock label="Signed by" name={staff.name} src={staff.signatureDataUrl} />
            )}
          </>
        ),
      };
    case "handbook":
      return {
        title: "Employee Handbook (Signed)",
        body: (
          <>
            <dl className={styles.modalDefs}>
              <div className={styles.modalDefRow}>
                <dt className={styles.modalDefLabel}>Acknowledged On</dt>
                <dd className={styles.modalDefValue}>
                  {staff.handbookSignedAt ? fmtDate(staff.handbookSignedAt) : "Not signed"}
                </dd>
              </div>
            </dl>
            {staff.signatureDataUrl && (
              <SignatureBlock label="Signed by" name={staff.name} src={staff.signatureDataUrl} />
            )}
            {staff.handbookSignedAt && (
              <p className={styles.modalHint}>
                {staff.name} confirmed they have read and understood the Yurica staff handbook.
              </p>
            )}
          </>
        ),
      };
    case "hrNotes":
      return {
        title: "HR Notes",
        body:
          hrNotes.length === 0 ? (
            <p className={styles.modalHint}>No HR notes recorded for this employee.</p>
          ) : (
            <ul className={styles.modalList}>
              {hrNotes.map((n) => (
                <li key={n.id} className={styles.modalNoteRow}>
                  <div className={styles.modalNoteHead}>
                    <span className={styles.modalNoteAuthor}>{n.kind}</span>
                    <span className={styles.modalNoteDate}>{n.date || "—"}</span>
                  </div>
                  {n.body && <p className={styles.modalNoteBody}>{n.body}</p>}
                  {n.addedBy && <p className={styles.modalNoteMeta}>Added by {n.addedBy}</p>}
                </li>
              ))}
            </ul>
          ),
      };
  }
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
      <span className={`${styles.infoValue} ${accent ? styles.infoValueAccent : ""}`}>{value}</span>
    </div>
  );
}

function TerminateModal({
  staff,
  defaultDate,
  submitting,
  onClose,
  onConfirm,
}: {
  staff: Staff;
  defaultDate: string;
  submitting: boolean;
  onClose: () => void;
  onConfirm: (lastDayISO: string) => void;
}) {
  const [lastDayISO, setLastDayISO] = useState<string>(() => {
    if (defaultDate) return defaultDate;
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const dateInputRef = useRef<HTMLInputElement | null>(null);

  function openDatePicker() {
    const el = dateInputRef.current;
    if (!el) return;
    // showPicker() opens the native OS date wheel — Safari added support
    // in 16.4, Chrome/Edge earlier. If it's missing (older iOS), fall back
    // to focusing the input which prompts the picker on tap-to-open.
    const anyEl = el as HTMLInputElement & { showPicker?: () => void };
    if (typeof anyEl.showPicker === "function") anyEl.showPicker();
    else el.focus();
  }

  return (
    <div
      className={styles.sheetBackdrop}
      role="dialog"
      aria-modal="true"
      aria-label="Terminate employee"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.sheet}>
        <div className={styles.sheetGrabber} aria-hidden="true" />
        <div className={styles.sheetHeader}>
          <div className={styles.sheetIcon} aria-hidden="true">
            <AlertOctagonIcon />
          </div>
          <div className={styles.sheetHeaderText}>
            <h3 className={styles.sheetTitle}>Terminate Employee?</h3>
            <p className={styles.sheetDesc}>
              Please confirm the last working date.
              <br />
              This employee will be moved from Active Employees to Terminated Employees.
            </p>
          </div>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onClose}
            aria-label="Close"
            disabled={submitting}
          >
            <CloseIcon />
          </button>
        </div>

        <section className={styles.sheetCard}>
          <p className={styles.sheetFieldLabel}>EMPLOYEE</p>
          <p className={styles.sheetEmployeeName}>{staff.name}</p>
          <p className={styles.sheetEmployeePos}>{staff.positionLabel}</p>

          <div className={styles.sheetDivider} aria-hidden="true" />

          <p className={styles.sheetFieldLabel}>LAST WORKING DATE</p>
          <div className={styles.sheetDateRow}>
            <span className={styles.sheetDateIcon} aria-hidden="true"><CalendarMiniIcon /></span>
            <span className={styles.sheetDateValue}>
              {fmtDateWithDay(lastDayISO)}
            </span>
            <button type="button" className={styles.sheetEditBtn} onClick={openDatePicker} disabled={submitting}>
              Edit
            </button>
            <input
              ref={dateInputRef}
              type="date"
              className={styles.sheetHiddenDate}
              value={lastDayISO}
              onChange={(e) => setLastDayISO(e.target.value)}
              disabled={submitting}
              aria-hidden="true"
              tabIndex={-1}
            />
          </div>
          <p className={styles.sheetHint}>This should be the employee&apos;s final day of work.</p>
        </section>

        <div className={styles.sheetInfoBox}>
          <span className={styles.sheetInfoIcon} aria-hidden="true"><InfoCircleIcon /></span>
          <p className={styles.sheetInfoText}>
            After termination, the employee will be removed from active schedules and payroll.
            All records and documents will be archived for reference.
          </p>
        </div>

        <div className={styles.sheetActions}>
          <button
            type="button"
            className={styles.sheetCancelBtn}
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.sheetConfirmBtn}
            onClick={() => onConfirm(lastDayISO)}
            disabled={submitting || !lastDayISO}
          >
            {submitting ? "Terminating…" : "Confirm Termination"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DefRow({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div className={styles.modalDefRow}>
      <dt className={styles.modalDefLabel}>{label}</dt>
      <dd className={styles.modalDefValue}>{value?.trim() ? value : "—"}</dd>
    </div>
  );
}

function SignatureBlock({ label, name, src }: { label: string; name: string; src: string }) {
  return (
    <div className={styles.signatureBlock}>
      <p className={styles.signatureLabel}>{label}</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={`${name} signature`} className={styles.signatureImg} />
      <p className={styles.signatureName}>{name}</p>
    </div>
  );
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

function StopIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  );
}

function AlertOctagonIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function InfoCircleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function CalendarMiniIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
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
