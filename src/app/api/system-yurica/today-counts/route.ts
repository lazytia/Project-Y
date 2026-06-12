import { NextResponse } from "next/server";
import { fetchSystemYuricaTodayCounts } from "@/lib/system-yurica";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await fetchSystemYuricaTodayCounts();
    return NextResponse.json(data);
  } catch (err) {
    console.error("[system-yurica/today-counts]", err);
    return NextResponse.json(
      { error: "Failed to fetch system_yurica counts" },
      { status: 502 },
    );
  }
}
