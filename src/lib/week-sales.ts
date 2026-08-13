import { adminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { shiftDateKey } from "@/lib/square";
import { warmWeekSalesCache, weekCacheIsSettled } from "@/lib/square-weekly-daily";

/**
 * Sydney-week Gross Sales lookup shared by the payroll and supplier-cost
 * summaries, both of which express their headline figure as a % of sales.
 *
 * Lookup precedence:
 *   1. sales_weekly_daily/{weekStart} — the Square-direct cache the
 *      /money/sales page fills. Covers older months that sales_daily
 *      doesn't have.
 *   2. sales_daily range query — nightly Firestore cache, recent months only.
 */

const TIMEZONE = "Australia/Sydney";

function todayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TIMEZONE });
}

function isoMondayOfDateKey(dateISO: string): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - dow);
  return dt.toISOString().slice(0, 10);
}

export async function loadWeekSalesBatch(weekStarts: string[]): Promise<number[]> {
  if (weekStarts.length === 0) return [];
  const out = new Array<number>(weekStarts.length).fill(0);

  const today = todayKey();

  try {
    const db = adminDb();
    const refs = weekStarts.map((ws) => db.collection("sales_weekly_daily").doc(ws));
    const snaps = await db.getAll(...refs);
    snaps.forEach((snap, i) => {
      if (!snap.exists) return;
      const data = snap.data() as { thisWeek?: { total?: number }; computedAt?: Timestamp };
      const weekStart = weekStarts[i];
      const weekIsOver = shiftDateKey(weekStart, 6, TIMEZONE) < today;
      if (
        weekIsOver &&
        !weekCacheIsSettled(weekStart, data.computedAt?.toDate?.() ?? null, TIMEZONE)
      ) {
        return;
      }
      const t = data.thisWeek?.total;
      if (typeof t === "number" && t > 0) out[i] = Math.round(t * 100) / 100;
    });
  } catch (err) {
    console.warn("[week-sales] weekly-cache batch lookup failed:", err);
  }

  const missingIdx = out.map((v, i) => (v > 0 ? -1 : i)).filter((i) => i >= 0);
  if (missingIdx.length === 0) return out;

  // Callers pass weeks newest-first, so the range has to come from the dates
  // themselves rather than their position in the array.
  const missingWeeks = missingIdx.map((i) => weekStarts[i]).sort();
  const startISO = missingWeeks[0];
  const endISO = shiftDateKey(missingWeeks[missingWeeks.length - 1], 6, TIMEZONE);
  try {
    const snap = await adminDb()
      .collection("sales_daily")
      .where("dateISO", ">=", startISO)
      .where("dateISO", "<=", endISO)
      .get();
    const totals = new Map(weekStarts.map((ws) => [ws, 0]));
    snap.docs.forEach((d) => {
      const dateISO = d.data().dateISO;
      if (typeof dateISO !== "string") return;
      const ws = isoMondayOfDateKey(dateISO);
      if (!totals.has(ws)) return;
      const v = d.data().grossSales;
      if (typeof v === "number") totals.set(ws, (totals.get(ws) ?? 0) + v);
    });
    for (const i of missingIdx) {
      const t = totals.get(weekStarts[i]) ?? 0;
      if (t > 0) out[i] = Math.round(t * 100) / 100;
    }
  } catch (err) {
    console.warn("[week-sales] sales_daily batch lookup failed:", err);
  }

  return out;
}

/** Read cache first; warm missing weeks in the background (never block the response). */
export async function loadWeekSalesResolved(weekStarts: string[]): Promise<number[]> {
  const out = await loadWeekSalesBatch(weekStarts);
  for (let i = 0; i < weekStarts.length; i++) {
    if (out[i] > 0) continue;
    void warmWeekSalesCache(weekStarts[i]).catch((err) => {
      console.warn("[week-sales] background sales warm failed for", weekStarts[i], err);
    });
  }
  return out;
}
