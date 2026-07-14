import { NextRequest, NextResponse } from "next/server";
import { fetchSupplierMonth, fetchSupplierTabTitles } from "@/lib/suppliers-sheet";

/**
 * GET /api/money/suppliers/inspect?month=YYYY-MM (optional)
 *
 * Debug endpoint: dumps the workbook's tab titles and, when a month is
 * supplied, the parsed month detail. Used to verify that the Google
 * sheet is shared with the service account and that the tab name
 * matcher picks the right sheet.
 */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get("month");
  try {
    const tabTitles = await fetchSupplierTabTitles();
    let detail = null;
    if (month) {
      detail = await fetchSupplierMonth(month);
    }
    return NextResponse.json({ tabTitles, month, detail });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed" },
      { status: 502 },
    );
  }
}
