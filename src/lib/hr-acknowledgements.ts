/**
 * Who has signed which HR document, from the owner's side.
 *
 * The staff-facing `/api/staff/document-signatures` is self-only by design —
 * nobody may read a colleague's signature — so the owner's view of the same
 * records needs its own owner-authorised route rather than a loosened rule.
 * This module holds the shape that crosses the wire and the counting that both
 * the Acknowledgements list and the per-document page do on the way out, so
 * the summary card and the page it links to can never disagree.
 *
 * Signature images never cross the wire: the pages only ever ask who signed
 * and when, and a PNG per person per document would be megabytes of payload
 * to answer a question about dates.
 */

import type { User } from "firebase/auth";
import {
  HR_DOCUMENTS,
  isSignatureCurrent,
  type HrDocument,
  type HrDocumentKey,
} from "./hr-documents";

const ENDPOINT = "/api/hr/acknowledgements";

export type AckStaffMember = {
  uid: string;
  name: string;
  position: string;
};

export type AckSignature = {
  signedAtISO: string | null;
  /** The document version signed against, or "" on records written before
   *  versions were kept. */
  version: string;
};

/** doc key → uid → signature. Absent means never signed. */
export type AckSignatureIndex = Partial<Record<HrDocumentKey, Record<string, AckSignature>>>;

export type AcknowledgementsPayload = {
  staff: AckStaffMember[];
  signatures: AckSignatureIndex;
};

/* ── Derived views ── */

export type AckPerson = AckStaffMember & {
  signedAtISO: string | null;
  /** Signed, against a version that still counts. */
  signed: boolean;
};

export type AckDocumentStatus = {
  doc: HrDocument;
  /** False for documents nobody is asked to sign. */
  requiresSignature: boolean;
  total: number;
  signed: number;
  pending: number;
  /** Everyone who has to sign has, so nothing is being chased. */
  complete: boolean;
  people: AckPerson[];
};

export function documentStatus(
  doc: HrDocument,
  payload: AcknowledgementsPayload,
): AckDocumentStatus {
  const byUid = payload.signatures[doc.key] ?? {};
  const requiresSignature = doc.signedVia !== null;

  const people: AckPerson[] = payload.staff.map((member) => {
    const entry = byUid[member.uid];
    const signed = !!entry && isSignatureCurrent(doc, entry.version || null);
    return {
      ...member,
      signedAtISO: entry?.signedAtISO ?? null,
      signed,
    };
  });

  const signedCount = people.filter((p) => p.signed).length;
  const total = requiresSignature ? people.length : 0;

  return {
    doc,
    requiresSignature,
    total,
    signed: requiresSignature ? signedCount : 0,
    pending: requiresSignature ? total - signedCount : 0,
    complete: requiresSignature && total > 0 && signedCount === total,
    people,
  };
}

export function allDocumentStatuses(payload: AcknowledgementsPayload): AckDocumentStatus[] {
  return HR_DOCUMENTS.map((doc) => documentStatus(doc, payload));
}

export type AckSummary = {
  items: number;
  upToDate: number;
  needsReview: number;
  /** People × documents still owed, which is what "3 Pending" counts. */
  pendingSignatures: number;
  /** Documents that have actually been issued — a version was cut and dated.
   *  The other two are a guide nobody has declared finished and a contract
   *  agreed inside the onboarding form, neither of which has an edition to
   *  point at. */
  updatedDocuments: number;
};

export function summarise(statuses: AckDocumentStatus[]): AckSummary {
  const tracked = statuses.filter((s) => s.requiresSignature);
  return {
    items: statuses.length,
    upToDate: tracked.filter((s) => s.complete).length,
    needsReview: tracked.filter((s) => !s.complete).length,
    pendingSignatures: tracked.reduce((sum, s) => sum + s.pending, 0),
    updatedDocuments: statuses.filter((s) => s.doc.version !== null).length,
  };
}

/* ── Client ── */

export async function fetchAcknowledgements(user: User): Promise<AcknowledgementsPayload> {
  const res = await fetch(ENDPOINT, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((payload as { error?: string })?.error ?? `Request failed (${res.status}).`);
  }
  return payload as AcknowledgementsPayload;
}
