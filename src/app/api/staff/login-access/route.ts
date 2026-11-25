import { NextResponse, type NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { isOwnerOrChefEmail } from "@/lib/permissions";

/**
 * POST /api/staff/login-access
 * Header: Authorization: Bearer <Firebase ID token>
 * Body:   { uid: string, disabled: boolean }
 *
 * Switches an employee's login off when they are terminated, and back on if
 * they are reactivated. Terminating used to leave the account working: the
 * record moved to Terminated and the person could still sign in the next day
 * and read the roster, their payslips and everybody's shifts.
 *
 * Disabling is what stops a fresh sign-in. Revoking the refresh tokens is what
 * stops the phone that is already signed in from quietly renewing — the app
 * also signs them out on sight of the terminated record (AuthProvider), and
 * this is the half that holds when the app is not open to see it.
 *
 * Only an owner or the head chef may call it, and no owner or chef account can
 * be switched off through it — locking the leadership out of the app is not
 * something a screen should be able to do by accident.
 */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const idToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!idToken) {
    return NextResponse.json({ error: "Missing bearer token." }, { status: 401 });
  }

  let callerEmail: string | null;
  try {
    callerEmail = (await adminAuth().verifyIdToken(idToken)).email ?? null;
  } catch {
    return NextResponse.json({ error: "Could not verify the sign-in." }, { status: 401 });
  }
  if (!isOwnerOrChefEmail(callerEmail)) {
    return NextResponse.json({ error: "Owners and the head chef only." }, { status: 403 });
  }

  let body: { uid?: unknown; disabled?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  const uid = typeof body.uid === "string" ? body.uid.trim() : "";
  const disabled = body.disabled;
  if (!uid || typeof disabled !== "boolean") {
    return NextResponse.json({ error: "uid and disabled are required." }, { status: 400 });
  }

  try {
    const target = await adminAuth().getUser(uid);
    if (isOwnerOrChefEmail(target.email ?? null)) {
      return NextResponse.json(
        { error: "An owner's or the head chef's login cannot be switched off here." },
        { status: 403 },
      );
    }

    await adminAuth().updateUser(uid, { disabled });
    // Only on the way out: a reactivated employee signs in fresh anyway, and
    // revoking there would be a round trip for nothing.
    if (disabled) await adminAuth().revokeRefreshTokens(uid);

    return NextResponse.json({ ok: true, uid, disabled });
  } catch (err) {
    const notFound =
      typeof err === "object" && err !== null && "code" in err
        ? (err as { code?: string }).code === "auth/user-not-found"
        : false;
    if (notFound) {
      // Nothing to switch off. A record without a login is not an error on
      // the way out — the termination it belongs to has to carry on.
      return NextResponse.json({ ok: true, uid, disabled, noAccount: true });
    }
    console.error("[login-access] failed:", err);
    return NextResponse.json({ error: "Could not change the login." }, { status: 502 });
  }
}
