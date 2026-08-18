import { NextResponse, type NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { OWNER_USERNAMES } from "@/lib/permissions";
import { emailToUsername } from "@/lib/username";
import { fetchWeekPayrollDetail } from "@/lib/payroll-sheet";
import {
  readPayslipPublication,
  writePayslipPublication,
  type PayslipPublication,
} from "@/lib/payslip-publication";

/**
 * GET  /api/payroll/payslips/publish?week=YYYY-MM-DD
 * POST /api/payroll/payslips/publish   body: { weekStartISO, published }
 * Header: Authorization: Bearer <Firebase ID token (owner)>
 *
 * The owner's release switch for one pay week, read and written from the
 * Timesheets page. GET also reports how many employees the sheet has for
 * that week so the card can say what is about to be released.
 *
 * Writes go through the Admin SDK rather than the client so publishing
 * stays owner-only server-side — `firestore.rules` never has to grant a
 * browser write on the collection the staff feed trusts.
 */

export const dynamic = "force-dynamic";

const WEEK_ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

type Caller = { uid: string; email: string | null };

async function verifyOwner(
  req: NextRequest,
): Promise<{ ok: true; caller: Caller } | { ok: false; status: number; error: string }> {
  const idToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!idToken) return { ok: false, status: 401, error: "Missing bearer token." };
  try {
    const decoded = await adminAuth().verifyIdToken(idToken);
    const username = emailToUsername(decoded.email ?? "").toLowerCase();
    if (!OWNER_USERNAMES.has(username)) {
      return { ok: false, status: 403, error: "Owner only." };
    }
    return { ok: true, caller: { uid: decoded.uid, email: decoded.email ?? null } };
  } catch (err) {
    return {
      ok: false,
      status: 401,
      error: `Token verification failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Sunday of the Monday-started pay week, without pulling in a date lib. */
function sundayOf(mondayISO: string): string {
  const [y, m, d] = mondayISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 6);
  return dt.toISOString().slice(0, 10);
}

/**
 * Employees in the sheet block for a week, or null when the sheet is
 * unreachable. Null is deliberately not 0: "we could not check" and "nobody
 * was paid" must not read the same on the card.
 */
async function sheetEmployeeCount(weekStartISO: string): Promise<number | null> {
  try {
    const detail = await fetchWeekPayrollDetail(weekStartISO);
    return detail ? detail.employees.length : 0;
  } catch (err) {
    console.warn("[payslips/publish] sheet read failed:", err);
    return null;
  }
}

function unpublished(weekStartISO: string): PayslipPublication {
  return {
    weekStartISO,
    weekEndISO: sundayOf(weekStartISO),
    published: false,
    publishedAt: null,
    publishedByUid: null,
    publishedByEmail: null,
    employeeCount: null,
  };
}

export async function GET(req: NextRequest) {
  const auth = await verifyOwner(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const weekStartISO = req.nextUrl.searchParams.get("week") ?? "";
  if (!WEEK_ISO_RE.test(weekStartISO)) {
    return NextResponse.json({ error: "Pass week as YYYY-MM-DD." }, { status: 400 });
  }

  const [record, employeeCount] = await Promise.all([
    readPayslipPublication(weekStartISO).catch((err) => {
      console.warn("[payslips/publish] publication read failed:", err);
      return null;
    }),
    sheetEmployeeCount(weekStartISO),
  ]);

  const base = record ?? unpublished(weekStartISO);
  return NextResponse.json({
    ...base,
    weekEndISO: base.weekEndISO || sundayOf(weekStartISO),
    // Live sheet count wins over the one stored at publish time — staff are
    // added and removed, and the card should describe the week as it is now.
    employeeCount: employeeCount ?? base.employeeCount,
  });
}

export async function POST(req: NextRequest) {
  const auth = await verifyOwner(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  const weekStartISO = String(body?.weekStartISO ?? "");
  if (!WEEK_ISO_RE.test(weekStartISO)) {
    return NextResponse.json({ error: "Pass weekStartISO as YYYY-MM-DD." }, { status: 400 });
  }
  // Default to publishing: the button that sends no flag is the publish
  // button, and an unpublish must say so explicitly.
  const published = body?.published !== false;

  const employeeCount = await sheetEmployeeCount(weekStartISO);
  if (published && employeeCount === 0) {
    return NextResponse.json(
      { error: "No payroll rows in the sheet for this week yet." },
      { status: 400 },
    );
  }

  try {
    const record = await writePayslipPublication({
      weekStartISO,
      weekEndISO: sundayOf(weekStartISO),
      published,
      byUid: auth.caller.uid,
      byEmail: auth.caller.email,
      employeeCount,
    });
    return NextResponse.json({ ok: true, ...record });
  } catch (err) {
    console.error("[payslips/publish] write failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not save the publish state." },
      { status: 500 },
    );
  }
}
