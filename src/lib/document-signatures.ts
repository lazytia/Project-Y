import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";

/**
 * Signed acknowledgements of internal documents (Staff Handbook, Beer Guide).
 *
 * Deliberately NOT stored on staff_onboarding: roughly fifteen call sites
 * enumerate that collection to build the People lists, Attention Required and
 * roster pickers, so writing a manager's handbook signature there would turn
 * Yurina and Chuck into employee records.
 */

export const DOCUMENT_SIGNATURES_COLLECTION = "document_signatures";

export type SignableDocumentKey = "handbook" | "beerGuide";

export const SIGNABLE_DOCUMENT_KEYS: readonly SignableDocumentKey[] = ["handbook", "beerGuide"];

export type DocumentSignature = {
  signature: string;
  signedAt: Date | null;
  version: string;
};

export type DocumentSignatures = Partial<Record<SignableDocumentKey, DocumentSignature>>;

function toDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === "object" && v !== null && "toDate" in v) {
    try {
      return (v as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }
  return null;
}

function readEntry(v: unknown): DocumentSignature | null {
  if (typeof v !== "object" || v === null) return null;
  const d = v as Record<string, unknown>;
  const signature = typeof d.signature === "string" ? d.signature : "";
  if (!signature) return null;
  return {
    signature,
    signedAt: toDate(d.signedAt),
    version: typeof d.version === "string" ? d.version : "",
  };
}

/** Staff who signed the handbook during onboarding have it under
 *  staff_onboarding/{uid}.policies, written before this collection existed —
 *  without this they would be asked to sign the same document a second time. */
async function legacyHandbookSignature(uid: string): Promise<DocumentSignature | null> {
  const snap = await getDoc(doc(getDb(), "staff_onboarding", uid));
  const policies = (snap.data()?.policies ?? {}) as Record<string, unknown>;
  const signature = typeof policies.handbookSignature === "string" ? policies.handbookSignature : "";
  if (!signature) return null;
  return {
    signature,
    signedAt: toDate(policies.handbookSignedAt),
    version: typeof policies.handbookVersion === "string" ? policies.handbookVersion : "",
  };
}

export async function fetchDocumentSignatures(uid: string): Promise<DocumentSignatures> {
  const snap = await getDoc(doc(getDb(), DOCUMENT_SIGNATURES_COLLECTION, uid));
  const data = (snap.data() ?? {}) as Record<string, unknown>;
  const signatures: DocumentSignatures = {};
  for (const key of SIGNABLE_DOCUMENT_KEYS) {
    const entry = readEntry(data[key]);
    if (entry) signatures[key] = entry;
  }
  if (!signatures.handbook) {
    const legacy = await legacyHandbookSignature(uid);
    if (legacy) signatures.handbook = legacy;
  }
  return signatures;
}

export async function saveDocumentSignature(
  uid: string,
  key: SignableDocumentKey,
  input: { signature: string; version: string },
): Promise<void> {
  await setDoc(
    doc(getDb(), DOCUMENT_SIGNATURES_COLLECTION, uid),
    {
      [key]: { ...input, signedAt: serverTimestamp() },
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}
