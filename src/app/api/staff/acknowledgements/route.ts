import { NextResponse, type NextRequest } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import {
  ACKNOWLEDGEMENTS_COLLECTION,
  GUIDELINE_KEYS,
  type AcknowledgementWire,
  type GuidelineKey,
} from "@/lib/acknowledgements";

/**
 * GET  /api/staff/acknowledgements
 * POST /api/staff/acknowledgements   body: { key, version }
 * Header: Authorization: Bearer <Firebase ID token>
 *
 * Ticked "I have read and understood" records, one document per person.
 *
 * Always scoped to the caller's own uid, taken from the verified token and
 * never from the request, so nobody can acknowledge on a colleague's behalf.
 * Written through the Admin SDK for the same reason the document signatures
 * are: the record has to land on our server, and a browser write quietly
 * depends on `firestore.rules` being in step.
 */

export const dynamic = "force-dynamic";

const MAX_VERSION_CHARS = 32;

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

export async function GET(req: NextRequest) {
  const uid = await callerUid(req);
  if (!uid) return NextResponse.json({ error: "Sign in to view your acknowledgements." }, { status: 401 });

  try {
    const snap = await adminDb().collection(ACKNOWLEDGEMENTS_COLLECTION).doc(uid).get();
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    const out: Partial<Record<GuidelineKey, AcknowledgementWire>> = {};
    for (const key of GUIDELINE_KEYS) {
      const entry = data[key];
      if (typeof entry !== "object" || entry === null) continue;
      const d = entry as Record<string, unknown>;
      out[key] = {
        acknowledgedAtISO: toISO(d.acknowledgedAt),
        version: typeof d.version === "string" ? d.version : "",
      };
    }
    return NextResponse.json(out);
  } catch (err) {
    console.error("[staff/acknowledgements] read failed:", err);
    return NextResponse.json({ error: "Could not read your acknowledgements." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const uid = await callerUid(req);
  if (!uid) return NextResponse.json({ error: "Sign in to acknowledge this." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const key = String(body?.key ?? "") as GuidelineKey;
  if (!GUIDELINE_KEYS.includes(key)) {
    return NextResponse.json({ error: "Unknown guidelines." }, { status: 400 });
  }
  const version = String(body?.version ?? "").trim();
  if (!version || version.length > MAX_VERSION_CHARS) {
    return NextResponse.json({ error: "A version is required." }, { status: 400 });
  }

  const acknowledgedAt = new Date();
  try {
    await adminDb()
      .collection(ACKNOWLEDGEMENTS_COLLECTION)
      .doc(uid)
      .set(
        { [key]: { version, acknowledgedAt }, updatedAt: acknowledgedAt },
        { merge: true },
      );
  } catch (err) {
    console.error("[staff/acknowledgements] write failed:", err);
    return NextResponse.json({ error: "Could not save your acknowledgement." }, { status: 500 });
  }

  const saved: AcknowledgementWire = { acknowledgedAtISO: acknowledgedAt.toISOString(), version };
  return NextResponse.json(saved);
}
