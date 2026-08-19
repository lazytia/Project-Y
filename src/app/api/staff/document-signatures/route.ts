import { NextResponse, type NextRequest } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import {
  DOCUMENT_SIGNATURES_COLLECTION,
  SIGNABLE_DOCUMENT_KEYS,
  type DocumentSignatureWire,
  type DocumentSignaturesWire,
  type SignableDocumentKey,
} from "@/lib/document-signatures";

/**
 * GET  /api/staff/document-signatures
 * POST /api/staff/document-signatures   body: { key, signature, version }
 * Header: Authorization: Bearer <Firebase ID token>
 *
 * Signed acknowledgements of the Staff Handbook and Beer Guide.
 *
 * Always scoped to the caller's own uid, taken from the verified token and
 * never from the request, so nobody can sign on a colleague's behalf.
 *
 * Reads and writes go through the Admin SDK rather than the browser. The
 * signature is a compliance record: it has to land on our server or not at
 * all, and a client write silently depends on `firestore.rules` being in
 * step — when the signing pages shipped four minutes ahead of the matching
 * rule every signature was rejected in the browser and nobody found out,
 * because the page had already drawn the signature on screen.
 */

export const dynamic = "force-dynamic";

/** A 560x200 pad produces roughly 10 KB of PNG. 400 KB allows a far denser
 *  scribble while keeping the document — which holds every signature for
 *  one person — well under Firestore's 1 MB ceiling. */
const MAX_SIGNATURE_CHARS = 400_000;
const SIGNATURE_PREFIX = "data:image/png;base64,";

async function callerUid(req: NextRequest): Promise<string | null> {
  const idToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!idToken) return null;
  try {
    return (await adminAuth().verifyIdToken(idToken)).uid;
  } catch {
    return null;
  }
}

function toISO(v: unknown): string | null {
  if (typeof v === "object" && v !== null && "toDate" in v) {
    try {
      return (v as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

function readEntry(v: unknown): DocumentSignatureWire | null {
  if (typeof v !== "object" || v === null) return null;
  const d = v as Record<string, unknown>;
  const signature = typeof d.signature === "string" ? d.signature : "";
  if (!signature) return null;
  return {
    signature,
    signedAtISO: toISO(d.signedAt),
    version: typeof d.version === "string" ? d.version : "",
  };
}

/** Staff who signed the handbook during onboarding have it under
 *  staff_onboarding/{uid}.policies, written before this collection existed —
 *  without this they would be asked to sign the same document a second time. */
async function legacyHandbook(uid: string): Promise<DocumentSignatureWire | null> {
  const snap = await adminDb().collection("staff_onboarding").doc(uid).get();
  const policies = (snap.data()?.policies ?? {}) as Record<string, unknown>;
  const signature = typeof policies.handbookSignature === "string" ? policies.handbookSignature : "";
  if (!signature) return null;
  return {
    signature,
    signedAtISO: toISO(policies.handbookSignedAt),
    version: typeof policies.handbookVersion === "string" ? policies.handbookVersion : "",
  };
}

async function readSignatures(uid: string): Promise<DocumentSignaturesWire> {
  const snap = await adminDb().collection(DOCUMENT_SIGNATURES_COLLECTION).doc(uid).get();
  const data = (snap.data() ?? {}) as Record<string, unknown>;
  const out: DocumentSignaturesWire = {};
  for (const key of SIGNABLE_DOCUMENT_KEYS) {
    const entry = readEntry(data[key]);
    if (entry) out[key] = entry;
  }
  if (!out.handbook) {
    const legacy = await legacyHandbook(uid);
    if (legacy) out.handbook = legacy;
  }
  return out;
}

export async function GET(req: NextRequest) {
  const uid = await callerUid(req);
  if (!uid) return NextResponse.json({ error: "Sign in to view your signatures." }, { status: 401 });

  try {
    return NextResponse.json(await readSignatures(uid));
  } catch (err) {
    console.error("[staff/document-signatures] read failed:", err);
    return NextResponse.json({ error: "Could not read your signatures." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const uid = await callerUid(req);
  if (!uid) return NextResponse.json({ error: "Sign in to sign this document." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const key = String(body?.key ?? "") as SignableDocumentKey;
  if (!SIGNABLE_DOCUMENT_KEYS.includes(key)) {
    return NextResponse.json({ error: "Unknown document." }, { status: 400 });
  }
  const signature = String(body?.signature ?? "");
  if (!signature.startsWith(SIGNATURE_PREFIX)) {
    return NextResponse.json({ error: "Signature must be a PNG data URL." }, { status: 400 });
  }
  if (signature.length > MAX_SIGNATURE_CHARS) {
    return NextResponse.json({ error: "Signature image is too large." }, { status: 413 });
  }
  const version = String(body?.version ?? "");

  const signedAt = new Date();
  try {
    await adminDb()
      .collection(DOCUMENT_SIGNATURES_COLLECTION)
      .doc(uid)
      .set(
        { [key]: { signature, version, signedAt }, updatedAt: signedAt },
        { merge: true },
      );
  } catch (err) {
    console.error("[staff/document-signatures] write failed:", err);
    return NextResponse.json({ error: "Could not save your signature." }, { status: 500 });
  }

  const saved: DocumentSignatureWire = {
    signature,
    signedAtISO: signedAt.toISOString(),
    version,
  };
  return NextResponse.json(saved);
}
