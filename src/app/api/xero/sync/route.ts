import { NextResponse, type NextRequest } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { authedXeroClient } from "@/lib/xero";
import { Timestamp } from "firebase-admin/firestore";

/* ──────────────────────────────────────────────────────────────────────
 * POST /api/xero/sync
 * Header: Authorization: Bearer <XERO_SYNC_SHARED_TOKEN>
 *
 * Pulls Xero pay runs whose pay date falls on the most recent Friday
 * (or any Friday in the last 6 weeks if no doc exists yet), and writes
 * the totals to `payroll_weekly/{Monday-of-that-work-week}` so the
 * Insights dashboard can read them.
 *
 * Schedule from Cloud Scheduler every Friday at ~17:00 AEST.
 * ──────────────────────────────────────────────────────────────────── */

function isoMonday(d: Date): string {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function parseXeroDate(s: string | undefined): Date | null {
  if (!s) return null;
  // Xero uses /Date(1486512000000+0000)/ in some endpoints; ISO in newer ones.
  const m = /\/Date\((\d+)/.exec(s);
  if (m) return new Date(parseInt(m[1], 10));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export async function POST(req: NextRequest) {
  const want = process.env.XERO_SYNC_SHARED_TOKEN ?? "";
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!want || got !== want) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { client, tenantId } = await authedXeroClient();

    // List pay runs (most recent first). The payroll endpoint differs
    // per region; this code is for the AU payroll API.
    const list = await client.payrollAUApi.getPayRuns(tenantId);
    const runs = list.body?.payRuns ?? [];

    const results: Array<{ weekStartISO: string; payDate: string; gross: number; super: number }> = [];

    for (const run of runs) {
      const payDate = parseXeroDate(run.paymentDate ?? run.payRunPeriodEndDate);
      if (!payDate) continue;
      // Only sync runs from the last 60 days to avoid backfilling forever.
      if (Date.now() - payDate.getTime() > 60 * 86400000) break;

      const detail = await client.payrollAUApi.getPayRun(tenantId, run.payRunID ?? "");
      const fullRun = detail.body?.payRuns?.[0];
      if (!fullRun) continue;

      const gross = Number(fullRun.wages ?? 0);
      const superCost = Number((fullRun as unknown as { super?: number; _super?: number }).super
        ?? (fullRun as unknown as { _super?: number })._super ?? 0);
      const weekStartISO = isoMonday(payDate);

      await adminDb()
        .collection("payroll_weekly")
        .doc(weekStartISO)
        .set(
          {
            weekStartISO,
            payDate: Timestamp.fromDate(payDate),
            gross,
            super: superCost,
            source: "xero",
            payRunID: run.payRunID ?? null,
            syncedAt: Timestamp.now(),
          },
          { merge: true },
        );
      results.push({ weekStartISO, payDate: payDate.toISOString(), gross, super: superCost });
    }

    return NextResponse.json({ ok: true, synced: results.length, runs: results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Sync failed.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
