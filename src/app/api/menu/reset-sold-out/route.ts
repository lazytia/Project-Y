import { NextResponse, type NextRequest } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { restoreAllCategories } from "@/lib/sold-out-square";

/**
 * POST /api/menu/reset-sold-out
 * Header: Authorization: Bearer <SOLD_OUT_RESET_SHARED_TOKEN>
 *
 * Daily 9 PM nightly reset:
 *  1. Restores every managed-category item in Square to
 *     presentAtAllLocations = true so POS + Online Ordering surfaces
 *     the items again tomorrow.
 *  2. Clears today's Firestore sold_out_daily/{today} doc so the
 *     Daily Sold Out page shows an empty slate.
 *
 * Schedule via Cloud Scheduler — cron "0 21 * * *" in
 * Australia/Sydney timezone.
 */
export async function POST(req: NextRequest) {
  const want = process.env.SOLD_OUT_RESET_SHARED_TOKEN ?? "";
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!want || got !== want) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await restoreAllCategories();

    // Wipe today's sold_out_daily entry so the page mirrors Square.
    const today = new Date().toLocaleDateString("en-CA");
    await adminDb().collection("sold_out_daily").doc(today).set(
      { soldOutIds: [], date: today, resetAt: Timestamp.now() },
      { merge: true },
    );

    return NextResponse.json({ ok: true, result, resetDate: today });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Reset failed.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
