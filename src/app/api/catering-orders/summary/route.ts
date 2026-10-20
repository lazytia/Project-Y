import { NextResponse, type NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { listPlatterCateringOrders } from "@/lib/catering-square";
import {
  applyScheduleOverride,
  fetchDetailsOverrides,
  fetchHiddenOrderIds,
  fetchScheduleOverrides,
  syncOrdersToFirestore,
} from "@/lib/catering-firestore";
import { applyDetailsOverride } from "@/lib/catering-orders";

export const dynamic = "force-dynamic";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isoDateToMonday(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - dow);
  return dt.toISOString().slice(0, 10);
}

/**
 * "11:30 AM" → 690, for ordering. Sorting the labels as text puts 11:30 AM
 * before 9:00 AM, which would name the wrong job as the first of the day.
 * Unparseable labels (Square prints "—" when an order has no slot) sort last
 * rather than first, so a missing time never masquerades as midnight.
 */
function minutesOfDay(label: string): number {
  const m = /^(\d{1,2}):(\d{2})\s*([AaPp])\.?[Mm]?\.?$/.exec(label.trim());
  if (m) {
    const hour = (parseInt(m[1], 10) % 12) + (m[3].toLowerCase() === "p" ? 12 : 0);
    return hour * 60 + parseInt(m[2], 10);
  }
  const h24 = /^(\d{1,2}):(\d{2})$/.exec(label.trim());
  if (h24) return parseInt(h24[1], 10) * 60 + parseInt(h24[2], 10);
  return Number.MAX_SAFE_INTEGER;
}

async function verifyAuth(req: NextRequest) {
  const idToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!idToken) return { ok: false as const, status: 401, error: "Missing bearer token." };
  try {
    await adminAuth().verifyIdToken(idToken);
    return { ok: true as const };
  } catch (err) {
    return {
      ok: false as const,
      status: 401,
      error: `Token verification failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

type SummaryOrder = {
  id: string;
  clientName: string;
  status: string;
  deliveryDateISO: string;
  deliveryTime: string;
  /** What the staff dashboard's "Next Catering" card shows. No prices here. */
  guestsCount: number;
  fulfillmentType: "PICKUP" | "DELIVERY" | null;
  /** The first line of the order and how many more follow it. */
  firstItem: { name: string; qty: number } | null;
  moreItems: number;
};

/**
 * Dashboard catering summary from Square (same source as /api/catering-orders).
 */
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const requested = req.nextUrl.searchParams.get("date");
  const todayKey =
    requested && DATE_KEY_RE.test(requested)
      ? requested
      : new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });

  const mondayKey = isoDateToMonday(todayKey);
  const [my, mm, md] = mondayKey.split("-").map(Number);
  const sundayKey = new Date(Date.UTC(my, mm - 1, md + 6)).toISOString().slice(0, 10);

  try {
    const [ordersRaw, hiddenIds, schedules, details] = await Promise.all([
      listPlatterCateringOrders(),
      fetchHiddenOrderIds(),
      fetchScheduleOverrides(),
      fetchDetailsOverrides(),
    ]);
    const visible =
      hiddenIds.size > 0 ? ordersRaw.filter((o) => !hiddenIds.has(o.id)) : ordersRaw;
    // Owner-corrected slots must win here too, otherwise the dashboard's
    // "next job" and week count would disagree with the calendar.
    const withSchedule =
      schedules.size > 0
        ? visible.map((o) => applyScheduleOverride(o, schedules.get(o.id)))
        : visible;
    // The owner's details too, so a renamed order is named the same here as on
    // the calendar.
    const orders =
      details.size > 0
        ? withSchedule.map((o) => applyDetailsOverride(o, details.get(o.id)))
        : withSchedule;
    syncOrdersToFirestore(orders);

    // Earliest first within a day too: two jobs on one date used to come back
    // in whatever order Square listed them, so the "next" one could be the
    // later pickup.
    const byDateThenTime = (a: (typeof orders)[number], b: (typeof orders)[number]) =>
      a.deliveryDateISO.localeCompare(b.deliveryDateISO) ||
      minutesOfDay(a.deliveryTime) - minutesOfDay(b.deliveryTime);

    const upcoming = orders
      .filter(
        (o) =>
          (o.status === "CONFIRMED" || o.status === "PENDING") && o.deliveryDateISO >= todayKey,
      )
      .sort(byDateThenTime);

    const next = upcoming[0];
    const nextOrder: SummaryOrder | null = next
      ? {
          id: next.id,
          clientName: next.clientName,
          status: next.status,
          deliveryDateISO: next.deliveryDateISO,
          deliveryTime: next.deliveryTime,
          guestsCount: next.guestsCount,
          fulfillmentType: next.fulfillmentType ?? null,
          firstItem: next.menu[0] ? { name: next.menu[0].name, qty: next.menu[0].qty } : null,
          moreItems: Math.max(0, next.menu.length - 1),
        }
      : null;

    const weekOrders = orders.filter(
      (o) =>
        o.deliveryDateISO >= mondayKey &&
        o.deliveryDateISO <= sundayKey &&
        o.status !== "CANCELLED",
    );
    const weekCount = weekOrders.length;

    // The first job still to come this week, today included. The manager's card
    // names the next job whenever it falls; the chef plans the week, so his names
    // the next one inside it. Same orders, different question, so it is answered
    // here rather than making the kitchen screen re-fetch and re-filter the whole
    // Square list itself.
    const weekNextOrder = weekOrders
      .filter((o) => o.deliveryDateISO >= todayKey)
      .sort(byDateThenTime)[0];

    return NextResponse.json({
      nextOrder,
      weekCount,
      weekNext: weekNextOrder
        ? { dateISO: weekNextOrder.deliveryDateISO, time: weekNextOrder.deliveryTime }
        : null,
    });
  } catch (err) {
    console.error("[catering-orders/summary]", err);
    return NextResponse.json({
      nextOrder: null,
      weekCount: 0,
      weekNext: null,
    });
  }
}
