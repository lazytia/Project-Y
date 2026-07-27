import { NextResponse } from "next/server";

/** Lightweight liveness probe — used by scheduled warm pings (no auth, no Firebase). */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true });
}
