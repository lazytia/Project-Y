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

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Signatures taken inside the onboarding form rather than in the app.
 *
 * The handbook has always been signed there, written to
 * staff_onboarding/{uid}.policies before this collection existed; the beer
 * guide joined it when hall staff started signing it as an onboarding step.
 * Without this, finishing onboarding would hand someone a dashboard asking
 * them to sign the documents they just signed.
 *
 * The field names are the document key plus a suffix — `handbookSignature`,
 * `beerGuideSignedAt` — so one read answers for every key and a third
 * document needs nothing added here.
 */
async function onboardingSignatures(uid: string): Promise<DocumentSignaturesWire> {
  const snap = await adminDb().collection("staff_onboarding").doc(uid).get();
  const policies = (snap.data()?.policies ?? {}) as Record<string, unknown>;
  const out: DocumentSignaturesWire = {};
  for (const key of SIGNABLE_DOCUMENT_KEYS) {
    const signature = str(policies[`${key}Signature`]);
    if (!signature) continue;
    out[key] = {
      signature,
      signedAtISO: toISO(policies[`${key}SignedAt`]),
      version: str(policies[`${key}Version`]),
    };
  }
  return out;
}

async function readSignatures(uid: string): Promise<DocumentSignaturesWire> {
  const snap = await adminDb().collection(DOCUMENT_SIGNATURES_COLLECTION).doc(uid).get();
  const data = (snap.data() ?? {}) as Record<string, unknown>;
  const out: DocumentSignaturesWire = {};
  for (const key of SIGNABLE_DOCUMENT_KEYS) {
    const entry = readEntry(data[key]);
    if (entry) out[key] = entry;
  }
  // One extra read, and only when something is still unaccounted for.
  if (SIGNABLE_DOCUMENT_KEYS.some((key) => !out[key])) {
    const fromOnboarding = await onboardingSignatures(uid);
    for (const key of SIGNABLE_DOCUMENT_KEYS) {
      if (!out[key] && fromOnboarding[key]) out[key] = fromOnboarding[key];
    }
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
