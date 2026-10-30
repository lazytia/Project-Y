import { NextResponse, type NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { claimDeviceToken } from "@/lib/fcm-claim-server";

/**
 * POST /api/fcm/claim
 * Header: Authorization: Bearer <Firebase ID token>
 * Body:   { token: string }
 *
 * Called right after a phone registers for notifications as the signed-in
 * person. Takes that phone off everyone else's record, so notices for the
 * people who used it before stop ringing on it.
 */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const idToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!idToken) return NextResponse.json({ error: "Missing bearer token." }, { status: 401 });

  let uid: string;
  try {
    uid = (await adminAuth().verifyIdToken(idToken)).uid;
  } catch {
    return NextResponse.json({ error: "Could not verify the sign-in." }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token) return NextResponse.json({ error: "token is required." }, { status: 400 });

  try {
    const removed = await claimDeviceToken(uid, token);
    if (removed === null) {
      return NextResponse.json({ error: "That device is not registered to you." }, { status: 400 });
    }
    return NextResponse.json({ ok: true, removed });
  } catch (err) {
    console.error("[fcm/claim] failed:", err);
    return NextResponse.json({ error: "Could not update the device." }, { status: 500 });
  }
}
