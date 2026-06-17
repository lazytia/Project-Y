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
import { isOwner } from "@/lib/permissions";
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
  amount?: number;
  signed?: boolean;
  paidAt?: Timestamp;
  createdAt?: Timestamp;
};

type Payment = {
  id: string;
  type: "trial-shift" | "active-employee";
  reason: string;
  recipientName: string;
  amount: number;
  signed: boolean;
  paidAt: Date | null;
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
  const allowed = isOwner(user);

  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!allowed) {
      router.replace(ROUTES.home);
      return;
    }
    (async () => {
      try {
        const snap = await getDocs(
          query(collection(getDb(), "cash_payments"), orderBy("paidAt", "desc")),
        );
        const list: Payment[] = snap.docs.map((d) => {
          const data = d.data() as StoredPayment;
          return {
            id: d.id,
            type: data.type ?? "active-employee",
            reason: data.reason ?? "Cash Payment",
            recipientName: data.recipientName ?? "Unknown",
            amount: typeof data.amount === "number" ? data.amount : 0,
            signed: !!data.signed,
            paidAt: tsDate(data.paidAt) ?? tsDate(data.createdAt),
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

  const monthSummary = useMemo(() => {
    const now = new Date();
    let total = 0;
    let count = 0;
    for (const p of payments) {
      if (sameMonth(p.paidAt, now)) {
        total += p.amount;
        count += 1;
      }
    }
    return { total, count };
  }, [payments]);

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
                  onClick={() => router.push(`/people/cash-payments/${p.id}`)}
                >
                  <span className={styles.avatar} aria-hidden="true">
                    {initials(p.recipientName)}
                  </span>
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
    </div>
  );
}
