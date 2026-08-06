import { NextResponse, type NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { candidateWebsiteUrls } from "@/lib/reservation-company";

export const dynamic = "force-dynamic";

const FETCH_TIMEOUT_MS = 6_000;
const SLUG_RE = /^[a-z0-9-]{2,48}$/;

function extractMeta(html: string): { title?: string; description?: string } {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const descMatch =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i) ??
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i);
  return {
    title: titleMatch?.[1]?.replace(/\s+/g, " ").trim(),
    description: descMatch?.[1]?.replace(/\s+/g, " ").trim(),
  };
}

async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "ProjectY-ReservationBot/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("text/html") && !type.includes("application/xhtml")) return null;
    const text = await res.text();
    return text.slice(0, 120_000);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

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

  const urls = candidateWebsiteUrls(slug);
  let websiteUrl: string | null = null;
  let title: string | undefined;
  let description: string | undefined;

  for (const candidate of urls) {
    const html = await fetchHtml(candidate);
    if (!html) continue;
    const meta = extractMeta(html);
    websiteUrl = candidate;
    title = meta.title;
    description = meta.description;
    if (description || title) break;
  }

  const tld = websiteUrl?.includes(".com.au") ? "com.au" : websiteUrl?.includes(".com") ? "com" : null;
  const summary =
    description ??
    (title && !title.toLowerCase().includes(slug)
      ? title
      : websiteUrl
        ? `Website found at ${websiteUrl.replace(/^https:\/\//, "")}.`
        : `Could not find a public website for ${name || slug}. Try searching manually.`);

  return NextResponse.json({
    companyName: name || slug,
    slug,
    websiteUrl,
    title: title ?? null,
    summary,
    tld,
  });
}
