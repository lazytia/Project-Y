import { NextResponse } from "next/server";
import {
  FRESH_TTL_MS,
  readFirestoreSoldOutCatalog,
  readMemorySoldOutCatalog,
  refreshSoldOutCatalogFromSquare,
  writeMemorySoldOutCatalog,
} from "@/lib/sold-out-catalog-cache";

/**
 * GET /api/menu/sold-out-categories
 *
 * Returns the four manageable sold-out categories. Reads a Firestore cache
 * first (~200 ms) so cold App Hosting instances don't walk the full Square
 * catalog on every page open; stale cache is served instantly while Square
 * refreshes in the background.
 */

const CACHE_HEADERS = {
  "cache-control": "private, max-age=300",
} as const;

export async function GET() {
  try {
    const mem = readMemorySoldOutCatalog();
    if (mem) {
      return NextResponse.json(mem, { headers: CACHE_HEADERS });
    }

    const cached = await readFirestoreSoldOutCatalog();
    if (cached) {
      writeMemorySoldOutCatalog(cached.body);
      if (cached.ageMs > FRESH_TTL_MS) {
        void refreshSoldOutCatalogFromSquare().catch((err) => {
          console.warn("[sold-out-categories] background refresh failed:", err);
        });
      }
      return NextResponse.json(cached.body, { headers: CACHE_HEADERS });
    }

    const body = await refreshSoldOutCatalogFromSquare();
    return NextResponse.json(body, { headers: CACHE_HEADERS });
  } catch (err) {
    const stale = await readFirestoreSoldOutCatalog();
    if (stale) {
      return NextResponse.json(stale.body, { headers: CACHE_HEADERS });
    }
    const msg = err instanceof Error ? err.message : "Failed to load Square catalog.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
