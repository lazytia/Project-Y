import { NextResponse, type NextRequest } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { OWNER_USERNAMES, CHEF_USERNAMES } from "@/lib/permissions";
import { emailToUsername } from "@/lib/username";
import { fetchWeeklyPayrollTotals } from "@/lib/payroll-sheet";
import {
  fetchOrders,
  getSalesDayRange,
  shiftDateKey,
  squareEnv,
  squareGrossSalesCents,
  sumRefundCents,
} from "@/lib/square";

/* ──────────────────────────────────────────────────────────────────────
 * POST /api/insights/refresh?week=YYYY-MM-DD
 * Authorization: Bearer <Firebase ID token of an owner>
 *
 * On-demand sync for the selected work week. Pulls:
 *   - Square Gross Sales for Mon → Sun of the week
 *   - Pay History "Total Inc Super" from the Google Sheet whose row
 *     matches the selected week
 * and stores both in Firestore so the Insights dashboard can show the
 * actual % vs the 25% target.
 *
 * Cron-style sync (no owner session) still runs through /api/square/sync
 * and /api/payroll/sync with the shared secret tokens.
 * ──────────────────────────────────────────────────────────────────── */

const ORDER_STATES = ["OPEN", "COMPLETED"];

async function verifyOwnerOrChef(req: NextRequest): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const header = req.headers.get("authorization") ?? "";
  const idToken = header.replace(/^Bearer\s+/i, "");
  if (!idToken) return { ok: false, status: 401, error: "Missing bearer token." };
  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(idToken);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 401, error: `Token verification failed: ${detail}` };
  }
  const email = decoded.email ?? "";
  const username = emailToUsername(email).toLowerCase();
  // Chefs read Roster Insights too, and the page syncs itself on open, so
  // their session has to be accepted here or the board would go stale for
  // them. All writes are idempotent (they overwrite Firestore with a fresh
  // Square/Sheet snapshot), so an extra caller costs nothing but a resync.
  if (!OWNER_USERNAMES.has(username) && !CHEF_USERNAMES.has(username)) {
    return {
      ok: false,
      status: 403,
      error: `Forbidden — owner/chef only (signed in as "${email || decoded.uid}").`,
    };
  }
  return { ok: true };
}

function parseIso(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  return isNaN(d.getTime()) ? null : d;
}

function isoOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

async function syncSquareWeek(mondayKey: string): Promise<{ grossSales: number; days: number }> {
  const locationId = squareEnv.locationId;
  if (!locationId) throw new Error("SQUARE_LOCATION_ID not set.");
  const tz = squareEnv.timezone;
  const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: tz });

  let weekGrossCents = 0;
  let daysIncluded = 0;
  for (let i = 0; i < 7; i += 1) {
    const dayKey = shiftDateKey(mondayKey, i, tz);
    if (dayKey > todayKey) continue;
    const { startAt, endAt } = getSalesDayRange(tz, dayKey);
    const orders = await fetchOrders(locationId, startAt, endAt, ORDER_STATES);
    let dayGross = 0;
    for (const o of orders) dayGross += squareGrossSalesCents(o);
    const refunds = await sumRefundCents(locationId, startAt, endAt);
    const dayNetCents = dayGross - refunds;
    await adminDb().collection("sales_daily").doc(dayKey).set(
      {
        dateISO: dayKey,
        weekStartISO: mondayKey,
        grossSales: Math.round(dayNetCents) / 100,
        currency: "AUD",
        source: "square",
        syncedAt: Timestamp.now(),
      },
      { merge: true },
    );
    weekGrossCents += dayNetCents;
    daysIncluded += 1;
  }
  const grossSales = Math.round(weekGrossCents) / 100;
  await adminDb().collection("sales_weekly").doc(mondayKey).set(
    {
      weekStartISO: mondayKey,
      grossSales,
      currency: "AUD",
      source: "square",
      daysIncluded,
      syncedAt: Timestamp.now(),
    },
    { merge: true },
  );
  return { grossSales, days: daysIncluded };
}

/**
 * Pull the requested weeks out of the payroll sheet and store them.
 *
 * One sheet read and one batched commit for all of them. It used to be a
 * read guarded by a module-level `cachedTotals` and a write per week, but
 * the four weeks are kicked off concurrently — so every one of them saw an
 * empty cache before the first read resolved and fetched the whole
 * spreadsheet again. Four reads where one was intended, on the call that
 * now runs on every page open.
 */
async function syncPayrollWeeksFromSheet(
  weeks: { iso: string; date: Date }[],
): Promise<{ iso: string; gross: number; super: number }[]> {
  const totals = await fetchWeeklyPayrollTotals();
  const db = adminDb();
  const batch = db.batch();
  const syncedAt = Timestamp.now();
  const results: { iso: string; gross: number; super: number }[] = [];
  for (const w of weeks) {
    const row = totals[w.iso];
    if (!row) continue; // week not on the sheet yet — leave Firestore alone
    batch.set(
      db.collection("payroll_weekly").doc(w.iso),
      {
        weekStartISO: w.iso,
        gross: row.totalIncSuper,
        super: 0,
        totalIncSuper: row.totalIncSuper,
        source: "google-sheet",
        syncedAt,
      },
      { merge: true },
    );
    results.push({ iso: w.iso, gross: row.totalIncSuper, super: 0 });
  }
  if (results.length > 0) await batch.commit();
  return results;
}

export async function POST(req: NextRequest) {
  const auth = await verifyOwnerOrChef(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const url = new URL(req.url);
  const weekParam = url.searchParams.get("week") ?? "";
  const weekStart = parseIso(weekParam);
  if (!weekStart) {
    return NextResponse.json({ error: "Pass ?week=YYYY-MM-DD (Monday)." }, { status: 400 });
  }
  const mondayKey = isoOf(weekStart);

  // Sync the selected week + the previous 3 weeks so the labour trend
  // chart (4 weeks) and the "vs last week" comparison fill in from a
  // single click of the refresh button.
  const SYNC_WEEKS = 4;
  const weeksToSync: { iso: string; date: Date }[] = [];
  for (let i = 0; i < SYNC_WEEKS; i += 1) {
    const d = addDays(weekStart, -7 * i);
    weeksToSync.push({ iso: isoOf(d), date: d });
  }

  const out: {
    week: string;
    square?: { grossSales: number; days: number; perWeek: { iso: string; grossSales: number; days: number }[] } | { error: string };
    xero?: { gross: number; super: number; payRunID: string | null; perWeek: { iso: string; gross: number; super: number }[] } | { error: string } | null;
  } = { week: mondayKey };

  // The two halves cost wildly different amounts, so the caller can ask
  // for just the cheap one.
  //
  //   Square  — 4 weeks × up to 7 days × 2 API calls. Expensive, and a
  //             finished week's sales can never change again.
  //   Payroll — one spreadsheet read. Cheap, and the one thing that DOES
  //             change after the fact, because the sheet is filled in by
  //             hand and gets corrected.
  //
  // Insights therefore asks for scope=payroll on most visits: the sheet is
  // re-read every time the page opens, without dragging Square along.
  const payrollOnly = url.searchParams.get("scope") === "payroll";

  if (!payrollOnly) {
    const squareSettled = await Promise.allSettled(
      weeksToSync.map((w) => syncSquareWeek(w.iso).then((r) => ({ iso: w.iso, ...r }))),
    );
    const sqResults: { iso: string; grossSales: number; days: number }[] = [];
    let sqError: string | null = null;
    for (const s of squareSettled) {
      if (s.status === "fulfilled") sqResults.push(s.value);
      else if (!sqError) sqError = s.reason instanceof Error ? s.reason.message : "Square sync failed.";
    }
    if (sqError && sqResults.length === 0) {
      out.square = { error: sqError };
    } else if (sqResults.length > 0) {
      const selected = sqResults.find((r) => r.iso === mondayKey) ?? sqResults[0];
      out.square = { grossSales: selected.grossSales, days: selected.days, perWeek: sqResults };
    }
  }

  let payResults: { iso: string; gross: number; super: number }[] = [];
  let payError: string | null = null;
  try {
    payResults = await syncPayrollWeeksFromSheet(weeksToSync);
  } catch (err) {
    payError = err instanceof Error ? err.message : "Payroll sync failed.";
  }
  if (payError && payResults.length === 0) {
    out.xero = { error: payError };
  } else if (payResults.length > 0) {
    const selected = payResults.find((r) => r.iso === mondayKey) ?? payResults[0];
    out.xero = { gross: selected.gross, super: selected.super, payRunID: null, perWeek: payResults };
  } else {
    out.xero = null;
  }

  return NextResponse.json({ ok: true, ...out });
}
