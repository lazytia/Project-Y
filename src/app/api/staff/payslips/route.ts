import { NextResponse, type NextRequest } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import {
  fetchAllWeekPayrollDetails,
  isEmptyPayrollDetail,
  type WeekPayrollDetail,
} from "@/lib/payroll-sheet";
import { shiftDateKey } from "@/lib/square";
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
/** How many past weeks to read from the Firestore cache. 60 covers
 *  a full year — payslip UI only shows the last 12 months anyway. */
const CACHE_WEEKS_LIMIT = 60;
/** Cache the JSON response at the edge for 5 min, serve stale for
 *  another 30 min while we revalidate. Numbers barely change during
 *  a pay cycle, and the cache read is already fast — this lets a
 *  second page load return instantly. */
const CACHE_HEADERS = {
  "Cache-Control": "private, max-age=300, stale-while-revalidate=1800",
} as const;

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

/** True when every token of one name appears in the other (either
 *  direction). Bidirectional subset handles all four common shapes:
 *  - Firestore has "Sakura Tanaka", sheet has "Sakura Tanaka" → match
 *  - Firestore has "Sakura Tanaka", sheet has "Tanaka, Sakura" → match
 *  - Firestore has "Sakura Tanaka", sheet has just "Sakura" → match
 *    (staff commonly logged under given name only)
 *  - Firestore has just "yurina" (login username fallback), sheet has
 *    "Yurina Y" → match
 *  Still rejects "Sakura Tanaka" vs "Sakura Ito" (partial overlap
 *  without full containment on either side). */
function nameMatches(candidate: string, sheetName: string): boolean {
  const sheetTokens = new Set(normaliseName(sheetName).split(" ").filter(Boolean));
  const candTokens = new Set(normaliseName(candidate).split(" ").filter(Boolean));
  if (candTokens.size === 0 || sheetTokens.size === 0) return false;
  const allCandInSheet = [...candTokens].every((t) => sheetTokens.has(t));
  const allSheetInCand = [...sheetTokens].every((t) => candTokens.has(t));
  return allCandInSheet || allSheetInCand;
}

async function resolveEmployeeName(
  uid: string,
  email: string | null,
): Promise<{ fullName: string; givenName: string; familyName: string } | null> {
  // Prefer the onboarding doc — regular staff always have one.
  try {
    const snap = await adminDb().collection("staff_onboarding").doc(uid).get();
    if (snap.exists) {
      const d = snap.data() as Record<string, unknown>;
      const fullName = String(d.fullName ?? "").trim();
      const givenName = String(d.givenName ?? "").trim();
      const familyName = String(d.familyName ?? "").trim();
      if (fullName || givenName || familyName) {
        return {
          fullName: fullName || [givenName, familyName].filter(Boolean).join(" "),
          givenName,
          familyName,
        };
      }
    }
  } catch (err) {
    console.warn("[staff/payslips] name lookup failed:", err);
  }
  // Owner/manager accounts (yurina, tia, yurica, eddie) are created
  // directly in Firebase Auth and never touch staff_onboarding — fall
  // back to the login username so their name still matches sheet rows
  // like "Yurina Yoshida" via the token-based nameMatches helper.
  const username = emailToUsername(email ?? "").trim();
  if (username) {
    return { fullName: username, givenName: username, familyName: "" };
  }
  return null;
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

  const nameInfo = await resolveEmployeeName(uid, callerEmail);
  if (!nameInfo) {
    return NextResponse.json(
      {
        employeeName: null,
        nextPayDateISO: null,
        payFrequency: "Paid weekly",
        payslips: [],
      },
      { headers: CACHE_HEADERS },
    );
  }

  // Sheet-first for correctness: the Google Sheet is the source of
  // truth for pay history. The Firestore cache written by
  // /api/payroll/summary is optimised for the owner's payroll view
  // and sometimes contains weeks where `employees[]` is empty (e.g.
  // when the summary route filled from payroll_weekly totals without
  // the per-staff breakdown). Reading cache-first meant Yurina and
  // other owner/manager accounts saw an empty list even though the
  // sheet had ~29 weeks of her payslips.
  //
  // The live sheet read is fast enough on the asia-southeast1
  // backend, and the client-side sessionStorage cache in the
  // /staff/payslips page keeps repeat page loads instant. Cache is
  // now a fallback only for when the Sheets API is unreachable.
  let allWeeks: WeekPayrollDetail[] = [];
  try {
    allWeeks = await fetchAllWeekPayrollDetails();
  } catch (err) {
    console.warn("[staff/payslips] sheet fetch failed — falling back to cache:", err);
  }
  if (allWeeks.length === 0) {
    try {
      // Doc IDs are weekStartISO (YYYY-MM-DD) so ordering by __name__
      // desc gives the newest weeks first — cheap and index-free.
      const snap = await adminDb()
        .collection("payroll_summary_cache")
        .orderBy("__name__", "desc")
        .limit(CACHE_WEEKS_LIMIT)
        .get();
      allWeeks = snap.docs
        .map((d) => (d.data() as { detail?: WeekPayrollDetail }).detail ?? null)
        // Only keep cached weeks that actually have per-employee
        // rows — otherwise nameMatches has nothing to match against
        // and the caller sees an empty list.
        .filter(
          (d): d is WeekPayrollDetail =>
            !!d && !isEmptyPayrollDetail(d) && Array.isArray(d.employees) && d.employees.length > 0,
        );
    } catch (err) {
      console.error("[staff/payslips] cache fallback failed:", err);
    }
  }
  if (allWeeks.length === 0) {
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

  return NextResponse.json(
    {
      employeeName: nameInfo.fullName,
      nextPayDateISO,
      payFrequency: "Paid weekly",
      payslips,
    },
    { headers: CACHE_HEADERS },
  );
}
