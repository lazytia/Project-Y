import { NextResponse, type NextRequest } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";

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
 * Dashboard-only catering summary from the Firestore mirror (no Square round-trip).
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
    const snap = await adminDb()
      .collection("catering_orders")
      .where("deliveryDateISO", ">=", todayKey)
      .limit(120)
      .get();

    const orders: SummaryOrder[] = [];
    for (const doc of snap.docs) {
      const data = doc.data();
      const status = String(data.status ?? "");
      if (status === "CANCELLED") continue;
      orders.push({
        id: doc.id,
        clientName: String(data.clientName ?? ""),
        status,
        deliveryDateISO: String(data.deliveryDateISO ?? ""),
        deliveryTime: String(data.deliveryTime ?? ""),
      });
    }

    orders.sort((a, b) => a.deliveryDateISO.localeCompare(b.deliveryDateISO));

    const nextOrder =
      orders.find((o) => (o.status === "CONFIRMED" || o.status === "PENDING")) ?? null;

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
