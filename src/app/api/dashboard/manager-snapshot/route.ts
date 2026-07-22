import { NextRequest, NextResponse } from "next/server";
import { prefetchManagerDash } from "@/lib/manager-dash-server";
import { isManagerDashboardKind } from "@/lib/session-dashboard";
import { sydneyTodayKey } from "@/lib/sydney-date";

export const dynamic = "force-dynamic";

/** Manager / chef dashboard snapshot — fetched client-side after instant HTML. */
export async function GET(request: NextRequest) {
  const uid = request.cookies.get("uid")?.value?.trim();
  const dash = request.cookies.get("dash")?.value?.trim();
  if (!uid || !isManagerDashboardKind(dash)) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const dateKey =
    request.nextUrl.searchParams.get("date")?.trim() || sydneyTodayKey();

  try {
    const snapshot = await prefetchManagerDash(dateKey);
    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "private, max-age=15" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fetch failed.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
