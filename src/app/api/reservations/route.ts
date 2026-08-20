import { NextResponse, type NextRequest } from "next/server";
import { callBooking, verifyAuth } from "@/lib/booking-api";

/**
 * Proxy to the yurica-system booking platform's admin API.
 *  GET  /api/reservations?date=YYYY-MM-DD&branch=northsydney → list
 *  POST /api/reservations  body = create payload                → create
 *
 * Keeps the booking origin server-side so the browser never talks to it
 * directly, and gates calls on a Firebase ID token.
 */
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? "";
  const branch = url.searchParams.get("branch") ?? "northsydney";
  if (!date) return NextResponse.json({ error: "Missing ?date=YYYY-MM-DD" }, { status: 400 });

  const res = await callBooking<{ reservations?: unknown[] }>(
    `/reservations?date=${encodeURIComponent(date)}&branch=${encodeURIComponent(branch)}`,
  );
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ reservations: res.data?.reservations ?? [] });
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }
  const res = await callBooking("/reservations", { method: "POST", body });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json(res.data);
}
