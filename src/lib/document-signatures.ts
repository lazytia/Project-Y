import type { User } from "firebase/auth";

/**
 * Signed acknowledgements of internal documents (Staff Handbook, Beer Guide).
 *
 * Deliberately NOT stored on staff_onboarding: roughly fifteen call sites
 * enumerate that collection to build the People lists, Attention Required and
 * roster pickers, so writing a manager's handbook signature there would turn
 * Yurina and Chuck into employee records.
 *
 * Both directions go through /api/staff/document-signatures rather than the
 * browser's Firestore client, so the record is written by our server against
 * the caller's verified uid.
 */

export const DOCUMENT_SIGNATURES_COLLECTION = "document_signatures";

const ENDPOINT = "/api/staff/document-signatures";

export type SignableDocumentKey = "handbook" | "beerGuide";

export const SIGNABLE_DOCUMENT_KEYS: readonly SignableDocumentKey[] = ["handbook", "beerGuide"];

export type DocumentSignature = {
  signature: string;
  signedAt: Date | null;
  version: string;
};

export type DocumentSignatures = Partial<Record<SignableDocumentKey, DocumentSignature>>;

/** What crosses the wire. Dates do not survive JSON, so the route sends ISO. */
export type DocumentSignatureWire = {
  signature: string;
  signedAtISO: string | null;
  version: string;
};

export type DocumentSignaturesWire = Partial<Record<SignableDocumentKey, DocumentSignatureWire>>;

function fromWire(w: DocumentSignatureWire): DocumentSignature {
  const parsed = w.signedAtISO ? new Date(w.signedAtISO) : null;
  return {
    signature: w.signature,
    signedAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed : null,
    version: w.version,
  };
}

async function call(user: User, init?: RequestInit): Promise<unknown> {
  const res = await fetch(ENDPOINT, {
    ...init,
    cache: "no-store",
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${await user.getIdToken()}`,
    },
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((payload as { error?: string })?.error ?? `Request failed (${res.status}).`);
  }
  return payload;
}

export async function fetchDocumentSignatures(user: User): Promise<DocumentSignatures> {
  const payload = (await call(user)) as DocumentSignaturesWire;
  const signatures: DocumentSignatures = {};
  for (const key of SIGNABLE_DOCUMENT_KEYS) {
    const entry = payload?.[key];
    if (entry?.signature) signatures[key] = fromWire(entry);
  }
  return signatures;
}

/** Resolves with the stored record, so the caller shows what the server kept
 *  rather than what it hoped it had sent. */
export async function saveDocumentSignature(
  user: User,
  key: SignableDocumentKey,
  input: { signature: string; version: string },
): Promise<DocumentSignature> {
  const payload = (await call(user, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, ...input }),
  })) as DocumentSignatureWire;
  return fromWire(payload);
}
