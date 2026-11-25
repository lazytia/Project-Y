/* ──────────────────────────────────────────────────────────────────────
 * Asking an owner to cancel a new hire's record.
 *
 * The kitchen used to delete these outright, and on 2026-11-24 two were:
 * the head chef removed them because neither was going to start, which was
 * a fair call made with a button that gave nobody else a say and left no
 * trace. The call is still his to raise — he is the one who knows the hire
 * is not coming — but the record now goes when an owner says so.
 *
 * So the button asks instead of deletes. The request lives on the record it
 * is about, which means it survives a reload, shows up on the owner's list
 * and travels into the archive with the document if the owner agrees.
 * ──────────────────────────────────────────────────────────────────── */

import type { User } from "firebase/auth";
import { doc, serverTimestamp, updateDoc, type Firestore } from "firebase/firestore";
import { actorNameOf } from "./permissions";
import { tsToDate } from "./staff-display";

export const CANCEL_REQUEST_FIELD = "cancelRequest";

export type StaffCancelRequest = {
  /** `pending` is waiting on an owner; `declined` is an owner saying keep. */
  status: "pending" | "declined";
  requestedAt: Date | null;
  requestedByName: string;
  reason: string;
  decidedAt: Date | null;
  decidedByName: string;
};

/** The request on a staff record, or null where there has never been one. */
export function readCancelRequest(raw: Record<string, unknown>): StaffCancelRequest | null {
  const v = raw[CANCEL_REQUEST_FIELD];
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const status = r.status === "declined" ? "declined" : "pending";
  return {
    status,
    requestedAt: tsToDate(r.requestedAt),
    requestedByName: typeof r.requestedByName === "string" ? r.requestedByName : "",
    reason: typeof r.reason === "string" ? r.reason : "",
    decidedAt: tsToDate(r.decidedAt),
    decidedByName: typeof r.decidedByName === "string" ? r.decidedByName : "",
  };
}

export function hasPendingCancelRequest(raw: Record<string, unknown>): boolean {
  return readCancelRequest(raw)?.status === "pending";
}

/**
 * Raise the request, and tell the owners.
 *
 * The record is written first and the notification second: the push is a
 * convenience — it needs the owner's phone to have accepted notifications —
 * while the record is what the owner's screens actually read. A push that
 * fails must not lose the request, so it is best-effort and never throws.
 */
export async function requestStaffCancel(input: {
  db: Firestore;
  uid: string;
  staffName: string;
  reason: string;
  actor: User | null | undefined;
}): Promise<void> {
  const { db, uid, staffName, reason, actor } = input;
  await updateDoc(doc(db, "staff_onboarding", uid), {
    [CANCEL_REQUEST_FIELD]: {
      status: "pending",
      requestedAt: serverTimestamp(),
      requestedByUid: actor?.uid ?? null,
      requestedByName: actorNameOf(actor),
      reason: reason.trim(),
      decidedAt: null,
      decidedByName: "",
    },
    updatedAt: serverTimestamp(),
  });

  try {
    if (!actor) return;
    const idToken = await actor.getIdToken();
    await fetch("/api/staff/cancel-request", {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ uid, staffName, reason: reason.trim() }),
    });
  } catch {
    /* The request is on the record; the owner's screens show it either way. */
  }
}

/** The owner's answer when the hire is staying: the request is kept, settled. */
export async function declineStaffCancel(input: {
  db: Firestore;
  uid: string;
  actor: User | null | undefined;
}): Promise<void> {
  const { db, uid, actor } = input;
  await updateDoc(doc(db, "staff_onboarding", uid), {
    [`${CANCEL_REQUEST_FIELD}.status`]: "declined",
    [`${CANCEL_REQUEST_FIELD}.decidedAt`]: serverTimestamp(),
    [`${CANCEL_REQUEST_FIELD}.decidedByName`]: actorNameOf(actor),
    updatedAt: serverTimestamp(),
  });
}
