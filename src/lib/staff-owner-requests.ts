/* ──────────────────────────────────────────────────────────────────────
 * The two things the kitchen can ask an owner to do to a staff record:
 * cancel a hire who is not starting, and terminate someone who is leaving.
 *
 * Both used to be buttons the head chef could press himself. On 2026-11-24
 * two new hires were deleted that way — a fair call, made with a button that
 * gave nobody else a say and left no trace of who pressed it. The call is
 * still the kitchen's to raise; carrying it out is the owners'.
 *
 * A request lives on the record it is about. That way it survives a reload,
 * shows on the owner's lists, and travels into the archive with the document
 * if the owner agrees to it.
 * ──────────────────────────────────────────────────────────────────── */

import type { User } from "firebase/auth";
import { doc, serverTimestamp, updateDoc, type Firestore } from "firebase/firestore";
import { actorNameOf } from "./permissions";
import { tsToDate } from "./staff-display";

/** Asking for a hire who never started to be taken off New Employees. */
export const CANCEL_REQUEST_FIELD = "cancelRequest";
/** Asking for someone already working to be finished up. */
export const TERMINATE_REQUEST_FIELD = "terminateRequest";

export type OwnerRequestField =
  | typeof CANCEL_REQUEST_FIELD
  | typeof TERMINATE_REQUEST_FIELD;

export type OwnerRequest = {
  /** `pending` is waiting on an owner; `declined` is an owner saying no. */
  status: "pending" | "declined";
  requestedAt: Date | null;
  requestedByName: string;
  reason: string;
  /** Termination requests only: the last day the kitchen is proposing. */
  lastWorkingDay: string;
  decidedAt: Date | null;
  decidedByName: string;
};

export function readOwnerRequest(
  raw: Record<string, unknown>,
  field: OwnerRequestField,
): OwnerRequest | null {
  const v = raw[field];
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  return {
    status: r.status === "declined" ? "declined" : "pending",
    requestedAt: tsToDate(r.requestedAt),
    requestedByName: typeof r.requestedByName === "string" ? r.requestedByName : "",
    reason: typeof r.reason === "string" ? r.reason : "",
    lastWorkingDay: typeof r.lastWorkingDay === "string" ? r.lastWorkingDay : "",
    decidedAt: tsToDate(r.decidedAt),
    decidedByName: typeof r.decidedByName === "string" ? r.decidedByName : "",
  };
}

const isPending = (raw: Record<string, unknown>, field: OwnerRequestField) =>
  readOwnerRequest(raw, field)?.status === "pending";

export const hasPendingCancelRequest = (raw: Record<string, unknown>) =>
  isPending(raw, CANCEL_REQUEST_FIELD);

export const hasPendingTerminateRequest = (raw: Record<string, unknown>) =>
  isPending(raw, TERMINATE_REQUEST_FIELD);

/**
 * Raise a request, and tell the owners.
 *
 * The record is written first and the notification second: the push needs
 * the owner's phone to have accepted notifications, while the record is what
 * the owner's screens actually read. A push that fails must not lose the
 * request, so it is best-effort and never throws.
 */
async function raise(input: {
  db: Firestore;
  uid: string;
  field: OwnerRequestField;
  staffName: string;
  reason: string;
  lastWorkingDay?: string;
  actor: User | null | undefined;
}): Promise<void> {
  const { db, uid, field, staffName, reason, lastWorkingDay, actor } = input;
  await updateDoc(doc(db, "staff_onboarding", uid), {
    [field]: {
      status: "pending",
      requestedAt: serverTimestamp(),
      requestedByUid: actor?.uid ?? null,
      requestedByName: actorNameOf(actor),
      reason: reason.trim(),
      lastWorkingDay: lastWorkingDay ?? "",
      decidedAt: null,
      decidedByName: "",
    },
    updatedAt: serverTimestamp(),
  });

  try {
    if (!actor) return;
    const idToken = await actor.getIdToken();
    await fetch("/api/staff/owner-request", {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        uid,
        staffName,
        reason: reason.trim(),
        lastWorkingDay: lastWorkingDay ?? "",
        kind: field === TERMINATE_REQUEST_FIELD ? "terminate" : "cancel",
      }),
    });
  } catch {
    /* The request is on the record; the owner's screens show it either way. */
  }
}

export function requestStaffCancel(input: {
  db: Firestore;
  uid: string;
  staffName: string;
  reason: string;
  actor: User | null | undefined;
}): Promise<void> {
  return raise({ ...input, field: CANCEL_REQUEST_FIELD });
}

export function requestStaffTerminate(input: {
  db: Firestore;
  uid: string;
  staffName: string;
  reason: string;
  lastWorkingDay: string;
  actor: User | null | undefined;
}): Promise<void> {
  return raise({ ...input, field: TERMINATE_REQUEST_FIELD });
}

/** The owner's answer when the person is staying: settled, and on record. */
export async function declineOwnerRequest(input: {
  db: Firestore;
  uid: string;
  field: OwnerRequestField;
  actor: User | null | undefined;
}): Promise<void> {
  const { db, uid, field, actor } = input;
  await updateDoc(doc(db, "staff_onboarding", uid), {
    [`${field}.status`]: "declined",
    [`${field}.decidedAt`]: serverTimestamp(),
    [`${field}.decidedByName`]: actorNameOf(actor),
    updatedAt: serverTimestamp(),
  });
}
