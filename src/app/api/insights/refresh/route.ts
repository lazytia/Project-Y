import { NextResponse, type NextRequest } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { OWNER_USERNAMES } from "@/lib/permissions";
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

async function verifyOwner(req: NextRequest): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
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
  if (!OWNER_USERNAMES.has(username)) {
    return {
      ok: false,
      status: 403,
      error: `Forbidden — owner only (signed in as "${email || decoded.uid}").`,
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
    weekGrossCents += dayGross - refunds;
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

// Cache the Sheet read for a single POST so all 4 trend weeks share one
// API call instead of pulling the whole spreadsheet four times.
let cachedTotals: Record<string, { totalIncSuper: number }> | null = null;

async function syncPayrollWeekFromSheet(
  weekStart: Date,
): Promise<{ gross: number; super: number } | null> {
  if (!cachedTotals) {
    try {
      cachedTotals = await fetchWeeklyPayrollTotals();
    } catch (err) {
      // Don't kill the whole request if the Sheet read fails.
      throw err;
    }
  }
  const key = isoOf(weekStart);
  const row = cachedTotals[key];
  if (!row) return null;
  await adminDb().collection("payroll_weekly").doc(key).set(
    {
      weekStartISO: key,
      gross: row.totalIncSuper,
      super: 0,
      totalIncSuper: row.totalIncSuper,
      source: "google-sheet",
      syncedAt: Timestamp.now(),
    },
    { merge: true },
  );
  return { gross: row.totalIncSuper, super: 0 };
}

export async function POST(req: NextRequest) {
  const auth = await verifyOwner(req);
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

  const sqResults: { iso: string; grossSales: number; days: number }[] = [];
  let sqError: string | null = null;
  for (const w of weeksToSync) {
    try {
      const r = await syncSquareWeek(w.iso);
      sqResults.push({ iso: w.iso, ...r });
    } catch (err) {
      sqError = err instanceof Error ? err.message : "Square sync failed.";
      break;
    }
  }
  if (sqError) {
    out.square = { error: sqError };
  } else if (sqResults.length > 0) {
    const selected = sqResults.find((r) => r.iso === mondayKey) ?? sqResults[0];
    out.square = { grossSales: selected.grossSales, days: selected.days, perWeek: sqResults };
  }

  // Reset the cache so this POST does exactly one Sheet fetch.
  cachedTotals = null;
  const payResults: { iso: string; gross: number; super: number }[] = [];
  let payError: string | null = null;
  let anyPay = false;
  for (const w of weeksToSync) {
    try {
      const r = await syncPayrollWeekFromSheet(w.date);
      if (r) {
        payResults.push({ iso: w.iso, gross: r.gross, super: r.super });
        anyPay = true;
      }
    } catch (err) {
      payError = err instanceof Error ? err.message : "Payroll sync failed.";
      break;
    }
  }
  if (payError) {
    out.xero = { error: payError };
  } else if (anyPay) {
    const selected = payResults.find((r) => r.iso === mondayKey) ?? payResults[0];
    out.xero = { gross: selected.gross, super: selected.super, payRunID: null, perWeek: payResults };
  } else {
    out.xero = null;
  }

  return NextResponse.json({ ok: true, ...out });
}
