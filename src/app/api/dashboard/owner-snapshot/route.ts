import { NextRequest, NextResponse } from "next/server";
import { prefetchOwnerDash } from "@/lib/owner-dash-server";
import { sydneyTodayKey } from "@/lib/sydney-date";

export const dynamic = "force-dynamic";

/** Owner dashboard snapshot — fetched client-side so HTML is never blocked. */
export async function GET(request: NextRequest) {
  const uid = request.cookies.get("uid")?.value?.trim();
  const role = request.cookies.get("role")?.value?.trim();
  if (!uid || role !== "owner") {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const dateKey =
    request.nextUrl.searchParams.get("date")?.trim() || sydneyTodayKey();

  try {
    const snapshot = await prefetchOwnerDash(dateKey);
    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "private, max-age=15" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fetch failed.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
