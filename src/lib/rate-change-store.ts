/**
 * Writes to an employee's scheduled rate changes (`rateChanges` on
 * `staff_onboarding/{uid}`). Client-side; owners and chefs may update the doc.
 *
 * Each write reads the list and puts it back inside a transaction, so two
 * people editing the same employee cannot drop each other's change. Entries
 * keep who scheduled them and when; readers only need the date and the rates.
 */

import { doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { RATE_CHANGES_FIELD, type RateChange } from "@/lib/staff-rates";

type StoredChange = Record<string, unknown> & { effectiveFrom?: unknown };

function storedList(raw: Record<string, unknown> | undefined): StoredChange[] {
  const list = raw?.[RATE_CHANGES_FIELD];
  return Array.isArray(list) ? list.filter((e): e is StoredChange => !!e && typeof e === "object") : [];
}

function byDate(a: StoredChange, b: StoredChange): number {
  return String(a.effectiveFrom ?? "").localeCompare(String(b.effectiveFrom ?? ""));
}

/**
 * Add a change, or replace one. `replacing` is the date of the change being
 * edited, so moving it to another day does not leave the old one behind; a
 * change already on the new date is replaced too.
 */
export async function saveRateChange(
  uid: string,
  change: RateChange,
  opts: { replacing?: string; scheduledBy: string },
): Promise<void> {
  const ref = doc(getDb(), "staff_onboarding", uid);
  await runTransaction(getDb(), async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("This employee record no longer exists.");
    const dropped = new Set([change.effectiveFrom, opts.replacing].filter(Boolean));
    const next = storedList(snap.data())
      .filter((e) => !dropped.has(String(e.effectiveFrom ?? "")))
      .concat({
        effectiveFrom: change.effectiveFrom,
        weekdayRate: change.weekday,
        saturdayRate: change.saturday,
        scheduledAt: new Date().toISOString(),
        scheduledBy: opts.scheduledBy,
      })
      .sort(byDate);
    tx.update(ref, { [RATE_CHANGES_FIELD]: next, updatedAt: serverTimestamp() });
  });
}

/** Take a scheduled change off. */
export async function removeRateChange(uid: string, effectiveFrom: string): Promise<void> {
  const ref = doc(getDb(), "staff_onboarding", uid);
  await runTransaction(getDb(), async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const next = storedList(snap.data()).filter((e) => String(e.effectiveFrom ?? "") !== effectiveFrom);
    tx.update(ref, { [RATE_CHANGES_FIELD]: next, updatedAt: serverTimestamp() });
  });
}
