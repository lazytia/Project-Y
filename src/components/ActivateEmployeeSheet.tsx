"use client";

/**
 * "Activate Employee?" — the one confirmation before an onboarding is signed
 * off, and the only place the write happens.
 *
 * Both the Ready for Review card and the Employee Review page offer the
 * button, and activation is not undoable from the UI: it stamps `activatedAt`,
 * which is what takes the employee off New Employees for good. Two copies of
 * that write would be two chances for one of them to forget a field — most
 * obviously `rejections`, which has to be cleared or the employee's own page
 * keeps showing a correction they made weeks ago.
 */

import { useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { activationPatch } from "@/lib/onboarding-review";
import { actorNameOf } from "@/lib/permissions";
import styles from "./ActivateEmployeeSheet.module.css";

export default function ActivateEmployeeSheet({
  uid,
  name,
  positionLabel,
  startDate,
  onClose,
  onActivated,
}: {
  uid: string;
  name: string;
  positionLabel: string;
  /** Already formatted — the two callers each have their own date helper. */
  startDate: string;
  onClose: () => void;
  onActivated: () => void;
}) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleActivate() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await updateDoc(
        doc(getDb(), "staff_onboarding", uid),
        activationPatch(user?.uid ?? "", actorNameOf(user)),
      );
      onActivated();
    } catch (e) {
      console.error("[activate] failed:", e);
      setError(e instanceof Error ? e.message : "Failed to activate. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className={styles.sheet}>
        <span className={styles.mark} aria-hidden="true">
          <CheckIcon />
        </span>
        <h2 className={styles.title}>Activate Employee?</h2>
        <p className={styles.body}>
          This will activate the employee and give them access to Scheduling,
          Clock In, and their Project YURICA account.
        </p>

        <div className={styles.summary}>
          <p className={styles.summaryName}>{name}</p>
          <p className={styles.summaryMeta}>
            {positionLabel} · Starts {startDate}
          </p>
        </div>

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.btnGhost}
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={() => void handleActivate()}
            disabled={busy}
          >
            {busy ? "Activating…" : "Activate Employee"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
