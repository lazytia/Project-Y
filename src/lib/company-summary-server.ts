import { candidateWebsiteUrls } from "@/lib/reservation-company";

const FETCH_TIMEOUT_MS = 12_000;

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-AU,en;q=0.9",
} as const;

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractMetaFromHtml(html: string): { title?: string; description?: string } {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  let description: string | undefined;

  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const meta = tag[0];
    if (!/(?:name|property)=["'](?:description|og:description)["']/i.test(meta)) continue;
    const content = meta.match(/\bcontent=["']([^"']+)["']/i)?.[1];
    if (content?.trim()) {
      description = decodeHtmlEntities(content);
      break;
    }
  }

  if (!description) {
    const ldMatch = html.match(
      /"@type"\s*:\s*"Organization"[\s\S]{0,4000}?"description"\s*:\s*"((?:\\.|[^"\\])*)"/,
    );
    if (ldMatch?.[1]) {
      try {
        description = decodeHtmlEntities(JSON.parse(`"${ldMatch[1]}"`));
      } catch {
        description = decodeHtmlEntities(ldMatch[1]);
      }
    }
  }

  return {
    title: titleMatch?.[1] ? decodeHtmlEntities(titleMatch[1]) : undefined,
    description,
  };
}

async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: BROWSER_HEADERS,
    });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    if (type && !type.includes("text/html") && !type.includes("application/xhtml")) return null;
    const text = await res.text();
    if (text.length < 200) return null;
    return text.slice(0, 160_000);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function probeWebsite(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const head = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
      headers: BROWSER_HEADERS,
    });
    if (head.ok) return true;
    if (head.status === 405 || head.status === 403) {
      const html = await fetchHtml(url);
      return !!html;
    }
    return false;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWikipediaExtract(query: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6_000);
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`,
      {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { extract?: string };
    const extract = data.extract?.trim();
    return extract || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function cleanTitle(title: string): string {
  return title.replace(/\s*[|\-–—]\s*.*$/, "").trim() || title;
}

export type CompanySummaryResult = {
  companyName: string;
  slug: string;
  websiteUrl: string | null;
  title: string | null;
  summary: string;
  tld: string | null;
  source: "website" | "wikipedia" | "url-only";
};

export async function buildCompanySummary(slug: string, name: string): Promise<CompanySummaryResult> {
  const companyName = name || slug;
  const urls = candidateWebsiteUrls(slug);

  let websiteUrl: string | null = null;
  let title: string | undefined;
  let description: string | undefined;
  let source: CompanySummaryResult["source"] = "url-only";

  for (const candidate of urls) {
    const html = await fetchHtml(candidate);
    if (!html) continue;
    const meta = extractMetaFromHtml(html);
    websiteUrl = candidate;
    title = meta.title;
    description = meta.description;
    if (description || title) {
      source = "website";
      break;
    }
  }

  if (!websiteUrl) {
    for (const candidate of urls) {
      if (await probeWebsite(candidate)) {
        websiteUrl = candidate;
        break;
      }
    }
  }

  let summary =
    description ??
    (title ? cleanTitle(title) : undefined);

  if (!summary) {
    for (const query of [companyName, slug.toUpperCase(), slug]) {
      const wiki = await fetchWikipediaExtract(query);
      if (wiki) {
        summary = wiki;
        source = "wikipedia";
        break;
      }
    }
  }

  if (!summary && websiteUrl) {
    summary = `${companyName} — visit ${websiteUrl.replace(/^https:\/\//, "")} for company details.`;
  } else if (!summary) {
    summary = `Could not find a public website or summary for ${companyName}. Try searching manually.`;
  }

  const tld = websiteUrl?.includes(".com.au")
    ? "com.au"
    : websiteUrl?.includes(".com")
      ? "com"
      : null;

  return {
    companyName,
    slug,
    websiteUrl,
    title: title ?? null,
    summary,
    tld,
    source,
  };
}
