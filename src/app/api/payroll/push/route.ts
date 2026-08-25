import { NextResponse, type NextRequest } from "next/server";
import { google } from "googleapis";
import { adminAuth } from "@/lib/firebase-admin";
import { OWNER_USERNAMES } from "@/lib/permissions";
import { emailToUsername } from "@/lib/username";
import {
  aggregateHoursByTeamMember,
  fetchMergedTimesheetShifts,
  teamMemberDisplayName,
} from "@/lib/timesheet-shifts-server";
import {
  BLOCK_READ_RANGE,
  DEFAULT_SHEET_ID,
  DEFAULT_TAB_NAME,
  lastBlockPremiumDay,
  lastBlockSheetEmployees,
  matchSheetEmployee,
  pushPayHistoryToSheet,
  type PayHistoryEmployeeHours,
} from "@/lib/payroll-sheet-push";

/**
 * POST /api/payroll/push
 * Header: Authorization: Bearer <Firebase ID token (owner)>
 * Body: { startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD" }
 */
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
  } catch (err) {
    return {
      ok: false,
      status: 401,
      error: `Token verification failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

const DAY_MS = 86_400_000;

/**
 * A Pay History block is a pay week, not any seven days.
 *
 * The page used to send whatever range was on screen, and its default is a
 * rolling last-7 — so a Wednesday-to-Tuesday window got written under a title
 * claiming to be a week's pay. Tax on this sheet is the weekly PAYG figure,
 * which makes hours drawn from two different weeks wrong twice over.
 */
function payWeekError(startDate: string, endDate: string): string | null {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (start.getUTCDay() !== 1) return "A pay week has to start on a Monday.";
  if (Math.round((end.getTime() - start.getTime()) / DAY_MS) !== 6) {
    return "A pay week has to run seven days, Monday to Sunday.";
  }
  return null;
}

async function readSheetRows(): Promise<unknown[][]> {
  const inline = (process.env.PAYROLL_SHEET_SA_JSON ?? process.env.FIREBASE_SERVICE_ACCOUNT_JSON)?.trim();
  if (!inline) throw new Error("Payroll sheet credentials not configured.");
  const creds = JSON.parse(inline);
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const tab = process.env.PAYROLL_SHEET_NAME ?? DEFAULT_TAB_NAME;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.PAYROLL_SHEET_ID ?? DEFAULT_SHEET_ID,
    range: `'${tab}'!${BLOCK_READ_RANGE}`,
  });
  return (res.data.values ?? []) as unknown[][];
}

export async function POST(req: NextRequest) {
  const auth = await verifyOwner(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  const startDate = String(body?.startDate ?? "");
  const endDate = String(body?.endDate ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return NextResponse.json(
      { error: "Pass startDate and endDate as YYYY-MM-DD." },
      { status: 400 },
    );
  }
  if (startDate > endDate) {
    return NextResponse.json({ error: "startDate must be on or before endDate." }, { status: 400 });
  }
  const weekError = payWeekError(startDate, endDate);
  if (weekError) return NextResponse.json({ error: weekError }, { status: 400 });

  try {
    const sheetRows = await readSheetRows();
    const sheetEmployees = lastBlockSheetEmployees(sheetRows);
    if (sheetEmployees.length === 0) {
      return NextResponse.json({ error: "Could not read employee roster from sheet." }, { status: 500 });
    }

    const premiumDay = lastBlockPremiumDay(sheetRows);
    const { shifts, teamMembers } = await fetchMergedTimesheetShifts(startDate, endDate);
    if (shifts.length === 0) {
      return NextResponse.json({ error: "No shifts in this date range." }, { status: 400 });
    }

    const byTeam = aggregateHoursByTeamMember(shifts, teamMembers, premiumDay);
    const hoursBySheetEmployee = new Map<string, PayHistoryEmployeeHours>();
    const unmatched: string[] = [];

    for (const [teamMemberId, hours] of byTeam) {
      const display = teamMemberDisplayName(teamMembers[teamMemberId], teamMemberId);
      const sheetName = matchSheetEmployee(display, sheetEmployees);
      if (!sheetName) {
        unmatched.push(display);
        continue;
      }
      const existing = hoursBySheetEmployee.get(sheetName);
      if (existing) {
        existing.weekHours += hours.weekHours;
        existing.premiumHours += hours.premiumHours;
      } else {
        hoursBySheetEmployee.set(sheetName, {
          sheetName,
          weekHours: hours.weekHours,
          premiumHours: hours.premiumHours,
        });
      }
    }

    const result = await pushPayHistoryToSheet(startDate, endDate, hoursBySheetEmployee);

    return NextResponse.json({
      ok: true,
      ...result,
      shiftCount: shifts.length,
      matchedStaff: hoursBySheetEmployee.size,
      unmatchedStaff: unmatched,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Push to Google failed.";
    console.error("[payroll/push] failed:", err);
    const status = /already exists/i.test(msg) ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
