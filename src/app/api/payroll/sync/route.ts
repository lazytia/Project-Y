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
    const isos = Object.keys(rows);

    // The sheet holds every week ever run, and this used to await one
    // document write per week in series — a round trip each, so the
    // endpoint got slower every payday. Batched, the whole sheet lands in
    // a couple of commits, which is what makes a sheet edit visible in
    // Insights within seconds rather than after a long tail of writes.
    const db = adminDb();
    const BATCH_LIMIT = 400; // Firestore allows 500 ops; leave headroom.
    const syncedAt = Timestamp.now();
    for (let i = 0; i < isos.length; i += BATCH_LIMIT) {
      const batch = db.batch();
      for (const iso of isos.slice(i, i + BATCH_LIMIT)) {
        const r = rows[iso];
        batch.set(
          db.collection("payroll_weekly").doc(iso),
          {
            weekStartISO: r.weekStartISO,
            weekEndISO: r.weekEndISO,
            totalIncSuper: r.totalIncSuper,
            // Keep the legacy field name the Insights page reads
            // (gross + super combined into a single total).
            gross: r.totalIncSuper,
            super: 0,
            source: "google-sheet",
            syncedAt,
          },
          { merge: true },
        );
      }
      await batch.commit();
    }
    return NextResponse.json({ ok: true, weeks: isos.length, synced: isos });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Sync failed.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
