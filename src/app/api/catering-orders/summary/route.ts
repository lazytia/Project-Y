import { NextResponse, type NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { listPlatterCateringOrders } from "@/lib/catering-square";
import { fetchHiddenOrderIds, syncOrdersToFirestore } from "@/lib/catering-firestore";

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
    const [ordersRaw, hiddenIds] = await Promise.all([
      listPlatterCateringOrders(),
      fetchHiddenOrderIds(),
    ]);
    const orders =
      hiddenIds.size > 0 ? ordersRaw.filter((o) => !hiddenIds.has(o.id)) : ordersRaw;
    syncOrdersToFirestore(orders);

    const upcoming = orders
      .filter(
        (o) =>
          (o.status === "CONFIRMED" || o.status === "PENDING") && o.deliveryDateISO >= todayKey,
      )
      .sort((a, b) => a.deliveryDateISO.localeCompare(b.deliveryDateISO));

    const nextOrder: SummaryOrder | null = upcoming[0]
      ? {
          id: upcoming[0].id,
          clientName: upcoming[0].clientName,
          status: upcoming[0].status,
          deliveryDateISO: upcoming[0].deliveryDateISO,
          deliveryTime: upcoming[0].deliveryTime,
        }
      : null;

    const weekCount = orders.filter(
      (o) =>
        o.deliveryDateISO >= mondayKey &&
        o.deliveryDateISO <= sundayKey &&
        o.status !== "CANCELLED",
    ).length;

    return NextResponse.json({ nextOrder, weekCount });
  } catch (err) {
    console.error("[catering-orders/summary]", err);
    return NextResponse.json({ nextOrder: null, weekCount: 0 });
  }
}
