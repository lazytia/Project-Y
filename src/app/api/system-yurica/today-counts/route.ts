import { NextRequest, NextResponse } from "next/server";
import { fetchSystemYuricaTodayCounts } from "@/lib/system-yurica";

export const dynamic = "force-dynamic";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const requested = req.nextUrl.searchParams.get("date");
  const dateKey = requested && DATE_KEY_RE.test(requested) ? requested : undefined;

  try {
    const data = await fetchSystemYuricaTodayCounts(dateKey);
    return NextResponse.json(data);
  } catch (err) {
    console.error("[system-yurica/today-counts]", err);
    return NextResponse.json(
      { error: "Failed to fetch system_yurica counts" },
      { status: 502 },
    );
  }
}
