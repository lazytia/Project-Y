import { NextResponse, type NextRequest } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { fetchWeeklyPayrollTotals } from "@/lib/payroll-sheet";

/**
 * POST /api/payroll/sync
 * Header: Authorization: Bearer <PAYROLL_SYNC_SHARED_TOKEN>
 *
 * Reads the Pay History sheet and stores every week's Total Inc Super
 * into payroll_weekly/{Monday-ISO}.
 *
 * Schedule with Cloud Scheduler weekly (Friday evening after the pay
 * run is finalised) — or manually trigger from the Insights page.
 */
export async function POST(req: NextRequest) {
  const want = process.env.PAYROLL_SYNC_SHARED_TOKEN ?? "";
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!want || got !== want) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const rows = await fetchWeeklyPayrollTotals();
    const synced: string[] = [];
    for (const iso of Object.keys(rows)) {
      const r = rows[iso];
      await adminDb().collection("payroll_weekly").doc(iso).set(
        {
          weekStartISO: r.weekStartISO,
          weekEndISO: r.weekEndISO,
          totalIncSuper: r.totalIncSuper,
          // Keep the legacy field name the Insights page reads
          // (gross + super combined into a single total).
          gross: r.totalIncSuper,
          super: 0,
          source: "google-sheet",
          syncedAt: Timestamp.now(),
        },
        { merge: true },
      );
      synced.push(iso);
    }
    return NextResponse.json({ ok: true, weeks: synced.length, synced });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Sync failed.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
