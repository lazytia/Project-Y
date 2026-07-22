import { NextResponse, type NextRequest } from "next/server";
import { fetchMergedTimesheetShifts } from "@/lib/timesheet-shifts-server";
import { squareEnv } from "@/lib/square";

/**
 * GET /api/payroll/timesheets?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 *
 * Returns timesheet shifts for the UI and payroll push:
 *   1. Square Labor (read-only import — never written back to Square)
 *   2. Local overrides in Firestore `timesheet_edits`
 *   3. App backfills in Firestore `timesheet_extra_shifts`
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const startDate = url.searchParams.get("startDate") ?? "";
  const endDate = url.searchParams.get("endDate") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return NextResponse.json(
      { error: "Pass ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD" },
      { status: 400 },
    );
  }

  const { locationId, timezone } = squareEnv;
  if (!locationId) {
    return NextResponse.json({ error: "SQUARE_LOCATION_ID not set" }, { status: 500 });
  }

  try {
    const { shifts, teamMembers } = await fetchMergedTimesheetShifts(startDate, endDate);
    return NextResponse.json({
      shifts,
      teamMembers,
      locationId,
      timezone: timezone ?? "UTC",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Timesheet fetch failed.";
    console.error("[payroll/timesheets] failed:", err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
