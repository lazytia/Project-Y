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
import {
  applyDetailsOverride,
  byCateringSchedule,
  isCateringStillToCome,
} from "@/lib/catering-orders";

export const dynamic = "force-dynamic";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isoDateToMonday(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - dow);
  return dt.toISOString().slice(0, 10);
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

    // Still to come: a later day, or today with its time not yet passed — so
    // once the 11:45 AM job has gone out, "next" is whatever follows it. Any
    // status but cancelled: Square marks a counter-paid order COMPLETED the
    // moment it is paid, which hid a job booked for tomorrow.
    const stillToCome = (o: (typeof orders)[number]) => isCateringStillToCome(o, todayKey);

    const upcoming = orders.filter(stillToCome).sort(byCateringSchedule);

    const toSummary = (o: (typeof orders)[number]): SummaryOrder => ({
      id: o.id,
      clientName: o.clientName,
      status: o.status,
      deliveryDateISO: o.deliveryDateISO,
      deliveryTime: o.deliveryTime,
      guestsCount: o.guestsCount,
      fulfillmentType: o.fulfillmentType ?? null,
      firstItem: o.menu[0] ? { name: o.menu[0].name, qty: o.menu[0].qty } : null,
      moreItems: Math.max(0, o.menu.length - 1),
    });

    // Every job on the next day that has one, earliest first: two or three
    // platters on the same day are all shown, not just the first.
    const nextDay = upcoming[0]?.deliveryDateISO;
    const nextOrders = nextDay
      ? upcoming.filter((o) => o.deliveryDateISO === nextDay).map(toSummary)
      : [];
    const nextOrder: SummaryOrder | null = nextOrders[0] ?? null;

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
    const weekNextOrder = weekOrders.filter(stillToCome).sort(byCateringSchedule)[0];

    return NextResponse.json({
      nextOrder,
      nextOrders,
      weekCount,
      weekNext: weekNextOrder
        ? { dateISO: weekNextOrder.deliveryDateISO, time: weekNextOrder.deliveryTime }
        : null,
    });
  } catch (err) {
    console.error("[catering-orders/summary]", err);
    return NextResponse.json({
      nextOrder: null,
      nextOrders: [],
      weekCount: 0,
      weekNext: null,
    });
  }
}
