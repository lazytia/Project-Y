import { NextResponse, type NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { buildCompanySummary } from "@/lib/company-summary-server";

export const dynamic = "force-dynamic";

const SLUG_RE = /^[a-z0-9-]{2,48}$/;

export async function GET(req: NextRequest) {
  const idToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!idToken) {
    return NextResponse.json({ error: "Missing bearer token." }, { status: 401 });
  }
  try {
    await adminAuth().verifyIdToken(idToken);
  } catch (err) {
    return NextResponse.json(
      { error: `Token verification failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 401 },
    );
  }

  const url = new URL(req.url);
  const slug = (url.searchParams.get("slug") ?? "").toLowerCase().trim();
  const name = (url.searchParams.get("name") ?? "").trim();
  if (!SLUG_RE.test(slug)) {
    return NextResponse.json({ error: "Invalid company slug." }, { status: 400 });
  }

  const result = await buildCompanySummary(slug, name);
  return NextResponse.json(result, {
    headers: {
      // Same company clicked again within the hour — reuse without re-searching.
      "Cache-Control": result.found
        ? "private, max-age=3600"
        : "private, max-age=30",
    },
  });
}
