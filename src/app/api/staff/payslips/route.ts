import { NextResponse, type NextRequest } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { fetchAllWeekPayrollDetails } from "@/lib/payroll-sheet";
import { shiftDateKey } from "@/lib/square";
import { OWNER_USERNAMES } from "@/lib/permissions";
import { emailToUsername } from "@/lib/username";

/**
 * GET /api/staff/payslips
 * Header:  Authorization: Bearer <Firebase ID token>
 *
 * Powers /staff/payslips. Reads the shared Google Sheet payroll history
 * once, then filters to the rows that match the signed-in staff member's
 * name (fullName / givenName+familyName from their staff_onboarding doc).
 *
 * Response shape:
 * {
 *   employeeName: string | null,
 *   nextPayDateISO: string | null,   // Wednesday after the latest pay week
 *   payFrequency: "Paid weekly",
 *   payslips: [{
 *     id: string,        // "p-YYYY-MM-DD" using the pay week's Monday
 *     payDate: string,   // Wednesday of the following week
 *     periodStart: string,
 *     periodEnd: string,
 *     grossPay: number,  // totalIncSuper (net + tax + super + cash)
 *     tax: number,
 *     super: number,
 *     netPay: number,
 *   }, ...]
 * }
 */

export const dynamic = "force-dynamic";

const TIMEZONE = "Australia/Sydney";

type Payslip = {
  id: string;
  payDate: string;
  periodStart: string;
  periodEnd: string;
  grossPay: number;
  tax: number;
  super: number;
  netPay: number;
};

/** Turn any spelling into a comparable token: lowercase, collapse
 *  runs of whitespace and punctuation into single spaces. */
function normaliseName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** True when every token of `candidate` appears in `sheetName` in any
 *  order — order-agnostic full-word matching so "Sakura Tanaka" hits
 *  both "Sakura Tanaka" and "Tanaka, Sakura" without matching partials
 *  like "Sakura T". */
function nameMatches(candidate: string, sheetName: string): boolean {
  const sheetTokens = new Set(normaliseName(sheetName).split(" ").filter(Boolean));
  const candTokens = normaliseName(candidate).split(" ").filter(Boolean);
  if (candTokens.length === 0 || sheetTokens.size === 0) return false;
  return candTokens.every((t) => sheetTokens.has(t));
}

async function resolveEmployeeName(uid: string): Promise<{
  fullName: string;
  givenName: string;
  familyName: string;
} | null> {
  try {
    const snap = await adminDb().collection("staff_onboarding").doc(uid).get();
    if (!snap.exists) return null;
    const d = snap.data() as Record<string, unknown>;
    const fullName = String(d.fullName ?? "").trim();
    const givenName = String(d.givenName ?? "").trim();
    const familyName = String(d.familyName ?? "").trim();
    if (!fullName && !givenName && !familyName) return null;
    return {
      fullName: fullName || [givenName, familyName].filter(Boolean).join(" "),
      givenName,
      familyName,
    };
  } catch (err) {
    console.warn("[staff/payslips] name lookup failed:", err);
    return null;
  }
}

export async function GET(req: NextRequest) {
  const idToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!idToken) {
    return NextResponse.json({ error: "Missing bearer token." }, { status: 401 });
  }
  let uid: string;
  let callerEmail: string | null = null;
  try {
    const decoded = await adminAuth().verifyIdToken(idToken);
    uid = decoded.uid;
    callerEmail = decoded.email ?? null;
  } catch (err) {
    return NextResponse.json(
      { error: `Token verification failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 401 },
    );
  }

  // Owner/manager can look up any staff member's payslips by passing
  // ?uid=<staffUid>. Regular staff can only see their own.
  const targetUid = req.nextUrl.searchParams.get("uid");
  if (targetUid && targetUid !== uid) {
    const callerUsername = emailToUsername(callerEmail ?? "").toLowerCase();
    if (!OWNER_USERNAMES.has(callerUsername)) {
      return NextResponse.json(
        { error: "Owner only." },
        { status: 403 },
      );
    }
    uid = targetUid;
  }

  const nameInfo = await resolveEmployeeName(uid);
  if (!nameInfo) {
    return NextResponse.json({
      employeeName: null,
      nextPayDateISO: null,
      payFrequency: "Paid weekly",
      payslips: [],
    });
  }

  let allWeeks: Awaited<ReturnType<typeof fetchAllWeekPayrollDetails>> = [];
  try {
    allWeeks = await fetchAllWeekPayrollDetails();
  } catch (err) {
    console.error("[staff/payslips] sheet fetch failed:", err);
    return NextResponse.json(
      { error: "Failed to read payroll sheet." },
      { status: 502 },
    );
  }

  const payslips: Payslip[] = [];
  for (const week of allWeeks) {
    // First: exact fullName match. Fallback: order-independent token
    // match against fullName or given+family — catches "Tanaka Sakura"
    // vs "Sakura Tanaka" style spellings without matching partials.
    const match = week.employees.find((e) => {
      if (nameMatches(nameInfo.fullName, e.name)) return true;
      const combo = `${nameInfo.givenName} ${nameInfo.familyName}`.trim();
      if (combo && nameMatches(combo, e.name)) return true;
      return false;
    });
    if (!match) continue;
    // Pay date = Wednesday of the week AFTER the pay week (weekEnd is
    // Sunday, +3 days → Wednesday). Matches the payroll cutoff logic
    // used by the onboarding overview.
    const payDate = shiftDateKey(week.weekEndISO, 3, TIMEZONE);
    payslips.push({
      id: `p-${week.weekStartISO}`,
      payDate,
      periodStart: week.weekStartISO,
      periodEnd: week.weekEndISO,
      grossPay: match.totalIncSuper,
      tax: match.tax,
      super: match.superAnn,
      netPay: match.netPay,
    });
  }

  payslips.sort((a, b) => (a.payDate < b.payDate ? 1 : -1));
  const nextPayDateISO = payslips.length > 0
    ? shiftDateKey(payslips[0].payDate, 7, TIMEZONE)
    : null;

  return NextResponse.json({
    employeeName: nameInfo.fullName,
    nextPayDateISO,
    payFrequency: "Paid weekly",
    payslips,
  });
}
