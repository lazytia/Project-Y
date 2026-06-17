"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, getDocs, query, where } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { isOwner } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import Splash from "@/components/Splash";
import CalendarPicker from "@/components/CalendarPicker";
import styles from "./page.module.css";
import { ACTIVE_DRAFT_KEY, type ActiveEmployeeDraft } from "./draft";

/* ──────────────────────────────────────────────────────────────────────
 * New Cash Payment → Active Employee — Step 1 of 2.
 * Captures employee, payment type, amount, reason and date, then
 * stashes them in sessionStorage and navigates to the payment/signature step.
 * ──────────────────────────────────────────────────────────────────── */

type StaffMember = { uid: string; name: string; position: string };
type PaymentType = ActiveEmployeeDraft["paymentType"];

const PAYMENT_TYPES: { value: PaymentType; label: string; desc: string }[] = [
  {
    value: "Payroll Adjustment",
    label: "Payroll Adjustment",
    desc: "Adjustments for hours, rates, penalties, deductions, etc.",
  },
  {
    value: "Advance Payment",
    label: "Advance Payment",
    desc: "Cash advance against upcoming wages.",
  },
  {
    value: "Final Pay",
    label: "Final Pay",
    desc: "Final payment including outstanding entitlements, wages.",
  },
];

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function fmtIsoShort(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

export default function ActiveEmployeeDetailsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwner(user);

  useEffect(() => {
    if (authLoading) return;
    if (!allowed) router.replace(ROUTES.home);
  }, [authLoading, allowed, router]);

  // Staff list
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [staffLoading, setStaffLoading] = useState(true);

  useEffect(() => {
    if (!allowed) return;
    const load = async () => {
      try {
        const snap = await getDocs(
          query(collection(getDb(), "staff_onboarding"), where("status", "==", "active"))
        );
        const list: StaffMember[] = snap.docs.map((doc) => {
          const d = doc.data();
          return {
            uid: doc.id,
            name: (d.fullName ?? d.name ?? doc.id) as string,
            position: (d.position ?? "") as string,
          };
        });
        list.sort((a, b) => a.name.localeCompare(b.name));
        setStaff(list);
      } catch {
        // ignore load errors; user can still proceed if list is empty
      } finally {
        setStaffLoading(false);
      }
    };
    load();
  }, [allowed]);

  // Form state
  const [selectedUid, setSelectedUid] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [paymentType, setPaymentType] = useState<PaymentType | "">("");
  const [amountStr, setAmountStr] = useState("");
  const [reason, setReason] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [calOpen, setCalOpen] = useState(false);

  // Hydrate from sessionStorage (back-navigation)
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem(ACTIVE_DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as Partial<ActiveEmployeeDraft>;
      if (d.employeeUid) setSelectedUid(d.employeeUid);
      if (d.paymentType) setPaymentType(d.paymentType);
      if (d.amountStr) setAmountStr(d.amountStr);
      if (d.reason) setReason(d.reason);
      if (d.paymentDate) setPaymentDate(d.paymentDate);
    } catch { /* ignore */ }
  }, []);

  const selectedStaff = staff.find((s) => s.uid === selectedUid) ?? null;
  const parsedAmount = parseFloat(amountStr) || 0;

  const canContinue =
    !!selectedUid &&
    !!paymentType &&
    parsedAmount > 0 &&
    reason.trim().length > 0;

  function handleNext() {
    if (!canContinue || !selectedStaff || !paymentType) return;
    const draft: ActiveEmployeeDraft = {
      employeeUid: selectedUid,
      employeeName: selectedStaff.name,
      employeePosition: selectedStaff.position,
      paymentType,
      amount: parsedAmount,
      amountStr,
      reason: reason.trim(),
      paymentDate,
    };
    try {
      window.sessionStorage.setItem(ACTIVE_DRAFT_KEY, JSON.stringify(draft));
    } catch {
      alert("Could not save draft — your browser may be out of storage.");
      return;
    }
    router.push("/people/cash-payments/new/active-employee/payment");
  }

  if (authLoading) return <Splash />;
  if (!allowed) return null;

  const checkMark = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => router.push("/people/cash-payments/new")}
          aria-label="Back"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className={styles.title}>Active Employee Payment</h1>
        <span />
      </header>

      {/* Stepper */}
      <div className={styles.stepper}>
        <div className={`${styles.step} ${styles.stepActive}`}>
          <span className={styles.stepBubble}>1</span>
          <span className={styles.stepLabel}>Details</span>
        </div>
        <span className={styles.stepLine} />
        <div className={`${styles.step} ${styles.stepPending}`}>
          <span className={styles.stepBubble}>2</span>
          <span className={styles.stepLabel}>Payment &amp; Signature</span>
        </div>
      </div>

      {/* 1. Employee */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>1. Employee</h2>
        {selectedStaff ? (
          <button
            type="button"
            className={styles.employeeCard}
            onClick={() => setPickerOpen(true)}
            aria-label="Change employee"
          >
            <div className={styles.employeeAvatar}>
              {initials(selectedStaff.name)}
            </div>
            <div>
              <p className={styles.employeeName}>{selectedStaff.name}</p>
              <p className={styles.employeePos}>
                {selectedStaff.position}{" "}
                <span className={styles.activeBadge}>Active Employee</span>
              </p>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            className={styles.selectBtn}
            onClick={() => setPickerOpen(true)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
            </svg>
            {staffLoading ? "Loading employees…" : "Select Employee"}
          </button>
        )}
      </section>

      {/* 2. Payment Type */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          2. Payment Type <span className={styles.requiredMark}>*</span>
        </h2>
        <ul className={styles.radioList}>
          {PAYMENT_TYPES.map((pt) => (
            <li key={pt.value}>
              <label
                className={`${styles.radioRow} ${paymentType === pt.value ? styles.radioRowOn : ""}`}
              >
                <input
                  type="radio"
                  name="paymentType"
                  className={styles.radioInput}
                  checked={paymentType === pt.value}
                  onChange={() => setPaymentType(pt.value)}
                />
                <span
                  className={`${styles.radioDot} ${paymentType === pt.value ? styles.radioDotOn : ""}`}
                />
                <div>
                  <p className={styles.radioLabel}>{pt.label}</p>
                  <p className={styles.radioDesc}>{pt.desc}</p>
                </div>
              </label>
            </li>
          ))}
        </ul>
      </section>

      {/* 3. Amount Paid */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          3. Amount Paid <span className={styles.requiredMark}>*</span>
        </h2>
        <div className={styles.amountInputWrap}>
          <span className={styles.amountPrefix}>$</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            className={styles.amountInput}
            placeholder="0.00"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
          />
          <span className={styles.metaLabel}>AUD</span>
        </div>
      </section>

      {/* 4. Reason / Notes */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          4. Reason / Notes <span className={styles.requiredMark}>*</span>
        </h2>
        <div className={styles.field}>
          <textarea
            className={styles.textarea}
            placeholder="Enter reason or notes for this payment…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            maxLength={250}
          />
          <p className={styles.charCount}>{reason.length} / 250</p>
        </div>
      </section>

      {/* 5. Payment Date */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>5. Payment Date</h2>
        <div className={styles.field}>
          <button
            type="button"
            className={styles.dateDisplayBtn}
            onClick={() => setCalOpen(true)}
          >
            <span className={styles.dateDisplayIcon} aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </span>
            {fmtIsoShort(paymentDate)}
          </button>
        </div>
      </section>

      <button
        type="button"
        className={styles.primaryBtn}
        disabled={!canContinue}
        onClick={handleNext}
      >
        Next: Payment &amp; Signature
        <span className={styles.btnChev} aria-hidden="true">›</span>
      </button>

      {/* Staff picker modal */}
      {pickerOpen && (
        <div
          className={styles.pickerBackdrop}
          onClick={() => setPickerOpen(false)}
        >
          <div
            className={styles.pickerSheet}
            onClick={(e) => e.stopPropagation()}
          >
            <p className={styles.pickerTitle}>Select Employee</p>
            {staffLoading && <p className={styles.metaLabel}>Loading…</p>}
            {!staffLoading && staff.length === 0 && (
              <p className={styles.metaLabel}>No active employees found.</p>
            )}
            {staff.map((s) => (
              <button
                key={s.uid}
                type="button"
                className={styles.pickerRow}
                onClick={() => {
                  setSelectedUid(s.uid);
                  setPickerOpen(false);
                }}
              >
                <div className={styles.pickerAvatar}>{initials(s.name)}</div>
                <div>
                  <p className={styles.pickerName}>{s.name}</p>
                  <p className={styles.pickerPos}>{s.position}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Calendar picker */}
      {calOpen && (
        <div className={styles.calOverlay} onClick={() => setCalOpen(false)}>
          <div className={styles.calSheet} onClick={(e) => e.stopPropagation()}>
            <CalendarPicker
              value={paymentDate}
              maxDate={todayIso()}
              singleOnly
              onChange={(dateKey) => {
                setPaymentDate(dateKey);
                setCalOpen(false);
              }}
              onRangeChange={() => { /* single-only mode */ }}
              onClose={() => setCalOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
