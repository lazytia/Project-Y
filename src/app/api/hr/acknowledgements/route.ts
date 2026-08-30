import { NextResponse, type NextRequest } from "next/server";
import { FieldPath } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { OWNER_USERNAMES } from "@/lib/permissions";
import { emailToUsername } from "@/lib/username";
import {
  DOCUMENT_SIGNATURES_COLLECTION,
  SIGNABLE_DOCUMENT_KEYS,
} from "@/lib/document-signatures";
import {
  STAFF_FLAG_FIELDS,
  isActiveEmployee,
  isTeamMember,
  staffOnboardingFlags,
} from "@/lib/staff-active";
import { fullNameOf, positionLabelOf } from "@/lib/staff-display";
import type {
  AckSignature,
  AckSignatureIndex,
  AckStaffMember,
  AcknowledgementsPayload,
} from "@/lib/hr-acknowledgements";

/**
 * GET /api/hr/acknowledgements
 * Header: Authorization: Bearer <Firebase ID token (owner)>
 *
 * Who on the roster has signed which HR document, and when.
 *
 * The staff-facing route next door is self-only — nobody may read a
 * colleague's signature — and that rule is worth keeping, so the owner's view
 * gets its own owner-authorised route instead of a widened `firestore.rules`.
 *
 * Both collections are read with a field projection. A staff document holds a
 * TFN signature and a handbook signature as PNG data URLs, and a signature
 * document holds one per document per person; a page that only wants dates
 * would otherwise download megabytes to render "Signed 26 Aug 2026".
 */

export const dynamic = "force-dynamic";

async function verifyOwner(
  req: NextRequest,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const idToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!idToken) return { ok: false, status: 401, error: "Missing bearer token." };
  try {
    const decoded = await adminAuth().verifyIdToken(idToken);
    const username = emailToUsername(decoded.email ?? "").toLowerCase();
    if (!OWNER_USERNAMES.has(username)) {
      return { ok: false, status: 403, error: "Owner only." };
    }
    return { ok: true };
  } catch {
    return { ok: false, status: 401, error: "Token verification failed." };
  }
}

function toISO(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object" && v !== null && "toDate" in v) {
    try {
      return (v as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** A signature entry, or null when the document was never signed. */
function readEntry(v: unknown): AckSignature | null {
  if (typeof v !== "object" || v === null) return null;
  const d = v as Record<string, unknown>;
  const signedAtISO = toISO(d.signedAt);
  if (!signedAtISO) return null;
  return { signedAtISO, version: str(d.version) };
}

export async function GET(req: NextRequest) {
  const auth = await verifyOwner(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const db = adminDb();
    const [staffSnap, signatureSnap] = await Promise.all([
      db
        .collection("staff_onboarding")
        .select(
          ...STAFF_FLAG_FIELDS,
          "fullName",
          "firstName",
          "lastName",
          "position",
          // The handbook, the privacy policy and the employment contract are
          // all signed inside the onboarding form — the handbook long before
          // `document_signatures` existed, the other two only ever there.
          new FieldPath("policies", "handbookSignedAt"),
          new FieldPath("policies", "handbookVersion"),
          new FieldPath("policies", "privacySignedAt"),
          new FieldPath("policies", "privacyVersion"),
          new FieldPath("policies", "agreementSignedAt"),
        )
        .get(),
      db
        .collection(DOCUMENT_SIGNATURES_COLLECTION)
        .select(
          ...SIGNABLE_DOCUMENT_KEYS.flatMap((key) => [
            new FieldPath(key, "signedAt"),
            new FieldPath(key, "version"),
          ]),
        )
        .get(),
    ]);

    const signed: AckSignatureIndex = { privacyPolicy: {}, employmentContract: {} };
    for (const key of SIGNABLE_DOCUMENT_KEYS) signed[key] = {};

    for (const docSnap of signatureSnap.docs) {
      const data = docSnap.data() as Record<string, unknown>;
      for (const key of SIGNABLE_DOCUMENT_KEYS) {
        const entry = readEntry(data[key]);
        if (entry) signed[key]![docSnap.id] = entry;
      }
    }

    const staff: AckStaffMember[] = [];
    for (const docSnap of staffSnap.docs) {
      const raw = docSnap.data() as Record<string, unknown>;
      const flags = staffOnboardingFlags(raw);
      if (!isTeamMember(flags) || !isActiveEmployee(flags)) continue;

      staff.push({
        uid: docSnap.id,
        name: fullNameOf(raw),
        position: positionLabelOf(raw),
      });

      const policies = (raw.policies ?? {}) as Record<string, unknown>;

      // Onboarding handbook signature — only when there is no newer one, so
      // re-signing in the app supersedes what onboarding recorded.
      if (!signed.handbook![docSnap.id]) {
        const handbookISO = toISO(policies.handbookSignedAt);
        if (handbookISO) {
          signed.handbook![docSnap.id] = {
            signedAtISO: handbookISO,
            version: str(policies.handbookVersion),
          };
        }
      }

      const privacyISO = toISO(policies.privacySignedAt);
      if (privacyISO) {
        signed.privacyPolicy![docSnap.id] = {
          signedAtISO: privacyISO,
          version: str(policies.privacyVersion),
        };
      }

      const agreementISO = toISO(policies.agreementSignedAt);
      if (agreementISO) {
        signed.employmentContract![docSnap.id] = { signedAtISO: agreementISO, version: "" };
      }
    }

    staff.sort((a, b) => a.name.localeCompare(b.name));

    const payload: AcknowledgementsPayload = { staff, signatures: signed };
    return NextResponse.json(payload);
  } catch (err) {
    console.error("[hr/acknowledgements] read failed:", err);
    return NextResponse.json({ error: "Could not read acknowledgements." }, { status: 500 });
  }
}
