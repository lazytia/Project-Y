"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  serverTimestamp,
  type Timestamp,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { emailToUsername } from "@/lib/username";
import Splash from "@/components/Splash";
import Toast from "@/components/Toast";
import styles from "./OwnerRequestDetail.module.css";

type RequestDoc = {
  fullName: string;
  givenName: string;
  familyName: string;
  position: string;
  startDate: string;
  trainingRate: number | null;
  trainingPeriod: string;
  afterTrainingRate: number | null;
  mobileNumber: string;
  visaExpiry: string;
  notes: string;
  requestedByName: string;
  createdAt: Date | null;
  status: string;
  approved: boolean;
  addedToScheduling: boolean;
  accountCreated: boolean;
};

function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "string") {
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

function toIsoDate(v: unknown): string {
  if (!v) return "";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = toDate(v);
  if (!d) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "—";
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtDateTime(d: Date | null): string {
  if (!d) return "—";
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const dayPart = sameDay
    ? "Today"
    : d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
  const timePart = d.toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${dayPart} ${timePart}`;
}

function positionLabel(raw: string): string {
  const p = raw.trim().toLowerCase();
  if (p === "kitchen" || p === "kitchen_staff" || p === "kitchen staff") return "Kitchen Staff";
  if (p === "hall" || p === "hall_staff" || p === "hall staff") return "Hall Staff";
  return raw.trim() || "Staff";
}

function fmtRate(n: number | null): string {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  return `$${n.toFixed(2)} / hour`;
}

function fmtMobile(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "—";
  const local = digits.startsWith("61") ? digits.slice(2) : digits.startsWith("0") ? digits.slice(1) : digits;
  if (local.length >= 9) {
    return `+61 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`.trim();
  }
  return `+61 ${local}`;
}

function requesterFallback(email: string | null | undefined): string {
  const u = emailToUsername(email).toLowerCase();
  if (u === "yurina") return "Yurina";
  if (u === "yurica") return "Yurica";
  if (u === "tia") return "Tia";
  if (!u) return "Manager";
  return u.charAt(0).toUpperCase() + u.slice(1);
}

function isApprovedStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s === "approved" || s === "active";
}

export default function OwnerRequestDetail() {
  const router = useRouter();
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : (params.id?.[0] ?? "");
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [docData, setDocData] = useState<RequestDoc | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [toast, setToast] = useState<{ title: string; message: string } | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(getDb(), "staff_onboarding", id));
        if (cancelled) return;
        if (!snap.exists()) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        const raw = snap.data() as Record<string, unknown>;
        let visaExpiry = toIsoDate(raw.visaExpiry);
        if (!visaExpiry && raw.documents && typeof raw.documents === "object") {
          const docs = raw.documents as Record<string, unknown>;
          visaExpiry = toIsoDate(docs.visaExpiry);
        }
        setDocData({
          fullName: String(raw.fullName ?? "").trim() || "Unnamed",
          givenName: String(raw.givenName ?? "").trim(),
          familyName: String(raw.familyName ?? "").trim(),
          position: positionLabel(String(raw.position ?? "")),
          startDate: toIsoDate(raw.startDate),
          trainingRate: typeof raw.trainingRate === "number" ? raw.trainingRate : null,
          trainingPeriod: String(raw.trainingPeriod ?? "—"),
          afterTrainingRate:
            typeof raw.afterTrainingRate === "number" ? raw.afterTrainingRate : null,
          mobileNumber: String(raw.mobileNumber ?? ""),
          visaExpiry,
          notes: String(raw.notes ?? "").trim(),
          requestedByName: String(raw.requestedByName ?? "").trim() || "Manager",
          createdAt: toDate(raw.createdAt),
          status: String(raw.status ?? ""),
          approved: isApprovedStatus(String(raw.status ?? "")) || !!raw.approvedAt,
          addedToScheduling: !!raw.addedToScheduling,
          accountCreated: !!raw.accountCreated,
        });
        setLoading(false);
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  function handleApprove() {
    if (!docData || docData.approved || busy) return;
    // Square provisioning intentionally deferred to a later step —
    // this button just navigates to the credentials screen. Owner
    // will trigger the Square create explicitly from there.
    router.push(`/people/onboarding/${id}/approve`);
  }

  async function handleUnapprove() {
    if (!docData || !docData.approved || busy) return;
    if (!window.confirm("Revert this request to Pending Approval?")) return;
    setBusy(true);
    try {
      await updateDoc(doc(getDb(), "staff_onboarding", id), {
        status: "Waiting for Documents",
        approvedAt: deleteField(),
        approvedByUid: deleteField(),
        approvedByName: deleteField(),
        addedToScheduling: false,
        accountCreated: false,
        updatedAt: serverTimestamp(),
      });
      setDocData((prev) =>
        prev
          ? {
              ...prev,
              approved: false,
              status: "Waiting for Documents",
              addedToScheduling: false,
              accountCreated: false,
            }
          : prev,
      );
      setToast({ title: "Reverted to pending", message: "The request can be approved again." });
    } catch {
      alert("Failed to revert. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDecline() {
    if (busy) return;
    setBusy(true);
    try {
      await deleteDoc(doc(getDb(), "staff_onboarding", id));
      setToast({ title: "Request declined", message: "The staff request has been removed." });
      window.setTimeout(() => router.push("/people/onboarding"), 900);
    } catch {
      alert("Failed to decline. Please try again.");
      setBusy(false);
    }
  }

  if (loading) return <Splash />;

  if (notFound || !docData) {
    return (
      <div className={styles.page}>
        <div className={styles.topBar}>
          <button
            type="button"
            className={styles.backBtn}
            onClick={() => router.push("/people/onboarding")}
            aria-label="Back"
          >
            <ChevronLeft />
          </button>
        </div>
        <p className={styles.notFoundMsg}>This request no longer exists.</p>
      </div>
    );
  }

  const pending = !docData.approved;

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <button
          type="button"
          className={styles.backBtn}
          onClick={() => router.push("/people/onboarding")}
          aria-label="Back to requests"
        >
          <ChevronLeft />
        </button>
      </div>

      <div className={styles.hero}>
        <p className={styles.eyebrow}>NEW STAFF REQUEST</p>
        <h1 className={styles.name}>{docData.fullName}</h1>
        <div className={styles.heroMeta}>
          <span
            className={`${styles.statusPill} ${docData.approved ? styles.statusPillApproved : ""}`}
          >
            {docData.approved ? "Approved" : "Pending Approval"}
          </span>
        </div>
        <p className={styles.position}>{docData.position}</p>
        <p className={styles.requestMeta}>
          <UserIcon />
          Requested by {docData.requestedByName}
          <span aria-hidden="true">|</span>
          <ClockIcon />
          {fmtDateTime(docData.createdAt)}
        </p>
      </div>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>START &amp; POSITION</h2>
        <div className={styles.grid2}>
          <div className={styles.fieldBlock}>
            <p className={styles.fieldLabel}>START DATE</p>
            <div className={styles.fieldRow}>
              <span className={styles.iconCircle}><CalendarIcon /></span>
              <p className={styles.fieldValue}>{fmtDate(docData.startDate)}</p>
            </div>
          </div>
          <div className={styles.fieldBlock}>
            <p className={styles.fieldLabel}>POSITION</p>
            <div className={styles.fieldRow}>
              <span className={styles.iconCircle}><BriefcaseIcon /></span>
              <p className={styles.fieldValue}>{docData.position}</p>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>PAY &amp; TRAINING</h2>
        <div className={styles.grid3}>
          <div className={styles.fieldBlock}>
            <p className={styles.fieldLabel}>TRAINING RATE</p>
            <div className={styles.fieldRow}>
              <span className={styles.iconCircle}><DollarIcon /></span>
              <p className={styles.fieldValue}>{fmtRate(docData.trainingRate)}</p>
            </div>
          </div>
          <div className={styles.fieldBlock}>
            <p className={styles.fieldLabel}>TRAINING PERIOD</p>
            <div className={styles.fieldRow}>
              <span className={styles.iconCircle}><CalendarIcon /></span>
              <p className={styles.fieldValue}>{docData.trainingPeriod}</p>
            </div>
          </div>
          <div className={styles.fieldBlock}>
            <p className={styles.fieldLabel}>AFTER TRAINING RATE</p>
            <div className={styles.fieldRow}>
              <span className={styles.iconCircle}><TrendIcon /></span>
              <p className={styles.fieldValue}>{fmtRate(docData.afterTrainingRate)}</p>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>MOBILE &amp; VISA</h2>
        <div className={styles.grid2}>
          <div className={styles.fieldBlock}>
            <p className={styles.fieldLabel}>MOBILE NUMBER</p>
            <div className={styles.fieldRow}>
              <span className={styles.iconCircle}><PhoneIcon /></span>
              <p className={styles.fieldValue}>{fmtMobile(docData.mobileNumber)}</p>
            </div>
          </div>
          <div className={styles.fieldBlock}>
            <p className={styles.fieldLabel}>VISA EXPIRY DATE</p>
            <div className={styles.fieldRow}>
              <span className={styles.iconCircle}><IdIcon /></span>
              <p className={styles.fieldValue}>{fmtDate(docData.visaExpiry)}</p>
            </div>
          </div>
        </div>
      </section>

      {docData.notes && (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>MANAGER NOTE</h2>
          <div className={styles.noteBox}>
            <span className={styles.noteQuote} aria-hidden="true">&ldquo;</span>
            <p className={styles.noteText}>{docData.notes}</p>
          </div>
        </section>
      )}

      {docData.approved && (
        <div className={styles.checksRow}>
          <span className={`${styles.checkItem} ${docData.addedToScheduling ? styles.checkDone : ""}`}>
            {docData.addedToScheduling ? "✓" : "○"} Added to Scheduling
          </span>
          <span className={`${styles.checkItem} ${docData.accountCreated ? styles.checkDone : ""}`}>
            {docData.accountCreated ? "✓" : "○"} Account Created
          </span>
        </div>
      )}

      {docData.approved && (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.declineBtn}
            disabled={busy}
            onClick={() => void handleUnapprove()}
          >
            Revert to Pending Approval
          </button>
        </div>
      )}

      {pending && (
        <div className={styles.actions}>
          {!confirmDecline ? (
            <>
              <button
                type="button"
                className={styles.approveBtn}
                disabled={busy}
                onClick={() => void handleApprove()}
              >
                <span className={styles.approveCheck} aria-hidden="true">✓</span>
                {busy ? "Approving…" : "Approve & Issue Staff ID"}
              </button>
              <button
                type="button"
                className={styles.declineBtn}
                disabled={busy}
                onClick={() => setConfirmDecline(true)}
              >
                <span aria-hidden="true">✕</span> Decline
              </button>
              <p className={styles.footerNote}>
                <InfoIcon />
                Approving will create the employee profile and send login details via SMS.
              </p>
            </>
          ) : (
            <div className={styles.confirmWrap}>
              <p className={styles.confirmText}>
                Decline this staff request? The onboarding record will be permanently removed.
              </p>
              <div className={styles.confirmRow}>
                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={() => setConfirmDecline(false)}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.confirmDeclineBtn}
                  disabled={busy}
                  onClick={() => void handleDecline()}
                >
                  {busy ? "Declining…" : "Yes, Decline"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {toast && (
        <Toast title={toast.title} message={toast.message} onClose={() => setToast(null)} />
      )}
    </div>
  );
}

function ChevronLeft() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function BriefcaseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
    </svg>
  );
}

function DollarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function TrendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <line x1="12" y1="18" x2="12.01" y2="18" />
    </svg>
  );
}

function IdIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="11" r="2" />
      <path d="M15 9h4M15 13h4" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}
