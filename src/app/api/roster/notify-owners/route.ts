import { NextResponse, type NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { announceRosterToOwners } from "@/lib/owner-announce";
import { isOwnerOrChefEmail } from "@/lib/permissions";
import { emailToUsername } from "@/lib/username";

/**
 * POST /api/roster/notify-owners
 * Header: Authorization: Bearer <Firebase ID token (owner or head chef)>
 * Body:   { ranges: string[], told: number }
 *
 * Called by the roster page after a Publish, so the owners hear about it
 * whoever pressed it: the head chef builds and publishes the roster, and the
 * owners were the one group who never found out.
 *
 * Only an owner or the chef may call it, and the name in the alert comes from
 * the verified token rather than from the request, so it cannot be used to put
 * words in somebody's mouth.
 */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const idToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!idToken) return NextResponse.json({ error: "Missing bearer token." }, { status: 401 });

  let uid: string;
  let email: string | null;
  try {
    const decoded = await adminAuth().verifyIdToken(idToken);
    uid = decoded.uid;
    email = decoded.email ?? null;
  } catch {
    return NextResponse.json({ error: "Could not verify the sign-in." }, { status: 401 });
  }
  if (!isOwnerOrChefEmail(email)) {
    return NextResponse.json({ error: "Owners and the head chef only." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const ranges = (Array.isArray(body?.ranges) ? body.ranges : [])
    .filter((r: unknown): r is string => typeof r === "string")
    .map((r: string) => r.trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 4);
  const told = Number.isFinite(body?.told) ? Math.max(0, Math.floor(body.told)) : 0;

  const username = emailToUsername(email ?? "");
  const who = username ? username.charAt(0).toUpperCase() + username.slice(1) : "Someone";
  const detail =
    `${who} published the roster${ranges.length > 0 ? ` for ${ranges.join(" and ")}` : ""}. ` +
    (told > 0 ? `${told} staff notified.` : "No shifts had changed, so no staff were notified.");

  try {
    const { owners } = await announceRosterToOwners({
      title: "Roster published",
      detail,
      url: "/scheduling/roster",
      excludeUid: uid,
    });
    return NextResponse.json({ ok: true, owners });
  } catch (err) {
    console.error("[roster/notify-owners] failed:", err);
    return NextResponse.json({ error: "Could not notify the owners." }, { status: 500 });
  }
}
