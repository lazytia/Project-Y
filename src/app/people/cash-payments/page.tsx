"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  getDocs,
  orderBy,
  query,
  type Timestamp,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { isOwner, isChef } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

/* ──────────────────────────────────────────────────────────────────────
 * Cash Payments — Owner + Manager only. Lists every recorded cash
 * payment (trial-shift candidates and active employees), totals for
 * the current month, and a CTA to record a new one.
 * ──────────────────────────────────────────────────────────────────── */

type StoredPayment = {
  type: "trial-shift" | "active-employee";
  reason?: string;       // "Trial Shift" | "Payroll Adjustment" | "Reimbursement" | "Advance Payment" | etc.
  recipientName?: string;
  recipientUid?: string | null;
  recipientPosition?: string;
  paymentType?: string;
  paymentMethod?: string;
  amount?: number;
  notes?: string | null;
  signed?: boolean;
  signatureUrl?: string;
  idPhotoUrl?: string;
  receiptPhotoUrl?: string;
  paidAt?: Timestamp;
  createdAt?: Timestamp;
  createdByName?: string;
};

type Payment = {
  id: string;
  type: "trial-shift" | "active-employee";
  reason: string;
  recipientName: string;
  recipientPosition: string;
  paymentType: string;
  paymentMethod: string;
  amount: number;
  notes: string;
  signed: boolean;
  signatureUrl: string;
  idPhotoUrl: string;
  receiptPhotoUrl: string;
  paidAt: Date | null;
  createdAt: Date | null;
  createdByName: string;
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
  return ((parts[0]?.charAt(0) ?? "?") + (parts[1]?.charAt(0) ?? "")).toUpperCase();
}

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtShort(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function sameMonth(a: Date | null, b: Date): boolean {
  if (!a) return false;
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export default function CashPaymentsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwner(user) || isChef(user);

  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => payments.find((p) => p.id === selectedId) ?? null,
    [payments, selectedId],
  );

  useEffect(() => {
    if (authLoading) return;
    if (!allowed) {
      router.replace(ROUTES.home);
      return;
    }
    (async () => {
      try {
        const snap = await getDocs(
          query(collection(getDb(), "cash_payments"), orderBy("createdAt", "desc")),
        );
        const list: Payment[] = snap.docs.map((d) => {
          const data = d.data() as StoredPayment;
          return {
            id: d.id,
            type: data.type ?? "active-employee",
            reason: data.reason ?? "Cash Payment",
            recipientName: data.recipientName ?? "Unknown",
            recipientPosition: data.recipientPosition ?? "",
            paymentType: data.paymentType ?? data.reason ?? "",
            paymentMethod: data.paymentMethod ?? "Cash",
            amount: typeof data.amount === "number" ? data.amount : 0,
            notes: typeof data.notes === "string" ? data.notes : "",
            signed: !!data.signed,
            signatureUrl: data.signatureUrl ?? "",
            idPhotoUrl: data.idPhotoUrl ?? "",
            receiptPhotoUrl: data.receiptPhotoUrl ?? "",
            paidAt: tsDate(data.paidAt) ?? tsDate(data.createdAt),
            createdAt: tsDate(data.createdAt),
            createdByName: data.createdByName ?? "",
          };
        });
        setPayments(list);
      } catch {
        /* keep empty */
      } finally {
        setLoading(false);
      }
    })();
  }, [authLoading, allowed, router]);

  const [todayKey, setTodayKey] = useState("");

  useEffect(() => {
    setTodayKey(new Date().toLocaleDateString("en-CA"));
  }, []);

  const monthSummary = useMemo(() => {
    if (!todayKey) return { total: 0, count: 0 };
    const [y, m] = todayKey.split("-").map(Number);
    const now = new Date(y, m - 1, 1);
    let total = 0;
    let count = 0;
    for (const p of payments) {
      if (sameMonth(p.paidAt, now)) {
        total += p.amount;
        count += 1;
      }
    }
    return { total, count };
  }, [payments, todayKey]);

  if (authLoading || loading) return <Splash />;
  if (!allowed) return null;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => router.push(ROUTES.home)}
            aria-label="Back"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        </div>
        <h1 className={styles.title}>Cash Payments</h1>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => router.push("/people/cash-payments/new")}
          aria-label="New cash payment"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </header>

      {/* Summary */}
      <section className={styles.summary}>
        <div className={styles.summaryBody}>
          <p className={styles.summaryLabel}>This Month</p>
          <p className={styles.summaryAmount}>{fmtCurrency(monthSummary.total)}</p>
          <p className={styles.summaryCount}>
            {monthSummary.count} {monthSummary.count === 1 ? "payment" : "payments"}
          </p>
        </div>
        <span className={styles.summaryIcon} aria-hidden="true">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="3" width="14" height="18" rx="2" />
            <line x1="12" y1="8" x2="12" y2="16" />
            <path d="M14.5 10.5a2 2 0 0 0-2-2h-1a1.5 1.5 0 0 0 0 3h1a1.5 1.5 0 0 1 0 3h-1a2 2 0 0 1-2-2" />
          </svg>
        </span>
      </section>

      <button
        type="button"
        className={styles.ctaBtn}
        onClick={() => router.push("/people/cash-payments/new")}
      >
        + New Cash Payment
      </button>

      {/* Recent payments */}
      <section className={styles.recent}>
        <div className={styles.recentHead}>
          <h2 className={styles.recentTitle}>Recent Payments</h2>
          <button type="button" className={styles.filterBtn} aria-label="Filter">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="7" y1="12" x2="17" y2="12" />
              <line x1="10" y1="18" x2="14" y2="18" />
            </svg>
          </button>
        </div>

        {payments.length === 0 ? (
          <p className={styles.empty}>
            No cash payments yet. Tap “+ New Cash Payment” to record one.
          </p>
        ) : (
          <ul className={styles.list}>
            {payments.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={styles.row}
                  onClick={() => setSelectedId(p.id)}
                >
                  <div className={styles.rowBody}>
                    <p className={styles.rowName}>{p.recipientName}</p>
                    <p className={styles.rowReason}>{p.reason}</p>
                    <p className={styles.rowDate}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="4" width="18" height="18" rx="2" />
                        <line x1="16" y1="2" x2="16" y2="6" />
                        <line x1="8" y1="2" x2="8" y2="6" />
                        <line x1="3" y1="10" x2="21" y2="10" />
                      </svg>
                      {fmtShort(p.paidAt)}
                    </p>
                  </div>
                  <div className={styles.rowRight}>
                    <p className={styles.rowAmount}>{fmtCurrency(p.amount)}</p>
                    <p className={`${styles.rowStatus} ${p.signed ? styles.rowStatusOk : styles.rowStatusNo}`}>
                      {p.signed ? (
                        <>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          Signed
                        </>
                      ) : (
                        "Not Signed"
                      )}
                    </p>
                  </div>
                  <span className={styles.chev} aria-hidden="true">›</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Detail modal */}
      {selected && (
        <div
          className={styles.modalBackdrop}
          role="dialog"
          aria-modal="true"
          aria-label="Cash payment details"
          onClick={() => setSelectedId(null)}
        >
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={styles.modalClose}
              onClick={() => setSelectedId(null)}
              aria-label="Close"
            >
              ×
            </button>

            {/* Hero — amount, type, paid date */}
            <header className={styles.detailHero}>
              <p className={styles.detailAmount}>{fmtCurrency(selected.amount)}</p>
              <p className={styles.detailKind}>
                {selected.paymentType || selected.reason}
              </p>
              <p className={styles.detailDate}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                {selected.paidAt
                  ? selected.paidAt.toLocaleString("en-AU", {
                      day: "numeric", month: "short", year: "numeric",
                      hour: "numeric", minute: "2-digit", hour12: true,
                    })
                  : "—"}
              </p>
            </header>

            {/* Payment Details */}
            <section className={styles.detailCard}>
              <h3 className={styles.detailCardTitle}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="3" width="16" height="18" rx="2" />
                  <line x1="8" y1="8" x2="16" y2="8" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                  <line x1="8" y1="16" x2="13" y2="16" />
                </svg>
                Payment Details
              </h3>
              <dl className={styles.detailTable}>
                <div className={styles.detailRow}>
                  <dt>Amount</dt>
                  <dd className={styles.detailRowWarm}>{fmtCurrency(selected.amount)}</dd>
                </div>
                <div className={styles.detailRow}>
                  <dt>Type</dt>
                  <dd>{selected.paymentType || selected.reason}</dd>
                </div>
                <div className={styles.detailRow}>
                  <dt>Paid By</dt>
                  <dd>{selected.createdByName || "—"}</dd>
                </div>
                <div className={styles.detailRow}>
                  <dt>Method</dt>
                  <dd>{selected.paymentMethod || "Cash"}</dd>
                </div>
              </dl>
            </section>

            {/* Reason / Notes */}
            {selected.notes && (
              <section className={styles.detailCard}>
                <h3 className={styles.detailCardTitle}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  Reason
                </h3>
                <p className={styles.detailNotesBox}>{selected.notes}</p>
              </section>
            )}

            {/* Employee Confirmation — inline signature image */}
            <section>
              <h3 className={styles.detailCardTitle}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
                </svg>
                Employee Confirmation
              </h3>
              <div className={`${styles.confirmCard} ${selected.signed ? styles.confirmCardOk : ""}`}>
                <div className={styles.confirmHeadRow}>
                  <span className={styles.confirmCheck} aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="9 12 11 14 15 10" />
                    </svg>
                  </span>
                  <div>
                    <p className={styles.confirmLabel}>{selected.signed ? "Signed" : "Not Signed"}</p>
                    {selected.signed && selected.createdAt && (
                      <p className={styles.confirmSub}>
                        {selected.createdAt.toLocaleString("en-AU", {
                          day: "numeric", month: "short", year: "numeric",
                          hour: "numeric", minute: "2-digit", hour12: true,
                        })}
                      </p>
                    )}
                  </div>
                </div>
                {selected.signatureUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={selected.signatureUrl}
                    alt="Signature"
                    className={styles.signatureImg}
                  />
                ) : selected.signed ? (
                  <p className={styles.signatureMissing}>Signature image not available.</p>
                ) : null}
              </div>
            </section>

            {/* Attachments */}
            <section>
              <h3 className={styles.detailCardTitle}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 11.5l-8.5 8.5a5 5 0 0 1-7-7l8.5-8.5a3.5 3.5 0 0 1 5 5L10.5 18a2 2 0 0 1-3-3l8-8" />
                </svg>
                Attachments
              </h3>
              {selected.idPhotoUrl || selected.receiptPhotoUrl ? (
                <div className={styles.attachGrid}>
                  {selected.idPhotoUrl && (
                    <a
                      href={selected.idPhotoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className={styles.attachCard}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={selected.idPhotoUrl} alt="ID" className={styles.attachImg} />
                      <p className={styles.attachLabel}>ID Photo</p>
                    </a>
                  )}
                  {selected.receiptPhotoUrl && (
                    <a
                      href={selected.receiptPhotoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className={styles.attachCard}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={selected.receiptPhotoUrl} alt="Receipt" className={styles.attachImg} />
                      <p className={styles.attachLabel}>Receipt Photo</p>
                    </a>
                  )}
                </div>
              ) : (
                <div className={styles.attachEmpty}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                  <div>
                    <p className={styles.attachEmptyTitle}>Receipt Photo (Optional)</p>
                    <p className={styles.attachEmptySub}>No attachment</p>
                  </div>
                </div>
              )}
            </section>

            <div className={styles.lockBanner}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <div>
                <p className={styles.lockTitle}>This record is securely stored and cannot be edited.</p>
                {selected.createdAt && (
                  <p className={styles.lockSub}>
                    Created on {selected.createdAt.toLocaleString("en-AU", {
                      day: "numeric", month: "short", year: "numeric",
                      hour: "numeric", minute: "2-digit", hour12: true,
                    })}{selected.createdByName ? ` by ${selected.createdByName}` : ""}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
