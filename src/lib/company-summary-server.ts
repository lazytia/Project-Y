import {
  candidateWebsiteUrls,
  companySlugCandidates,
} from "@/lib/reservation-company";

const SEARCH_TIMEOUT_MS = 2_500;
const SITE_TIMEOUT_MS = 2_800;
const SITE_HTML_CAP = 200_000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const MISS_CACHE_TTL_MS = 30_000;

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-AU,en;q=0.9",
} as const;

type SearchHit = {
  snippet: string;
  url?: string;
  title?: string;
  source: "website" | "google" | "search";
};

const summaryCache = new Map<string, { at: number; value: CompanySummaryResult }>();

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(parseInt(num, 10)))
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtmlTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, " "));
}

/** Keep summaries short — first two sentences, capped length. */
export function simplifySummary(text: string, maxLen = 320): string {
  const cleaned = stripHtmlTags(text);
  const sentences = cleaned.match(/[^.!?]+[.!?]+(?:\s|$)/g);
  if (!sentences?.length) return cleaned.slice(0, maxLen).trim();

  let out = "";
  for (const sentence of sentences) {
    const next = out + sentence;
    if (next.length > maxLen) break;
    out = next;
    if (out.split(/[.!?]/).filter(Boolean).length >= 2) break;
  }
  return out.trim() || cleaned.slice(0, maxLen).trim();
}

export function googleSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function normalizeWebsiteUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    const path = parsed.pathname.replace(/\/+$/, "") || "";
    return `${parsed.origin}${path}`;
  } catch {
    return url;
  }
}

function detectTld(url: string | null): string | null {
  if (!url) return null;
  if (/\.com\.au(\/|$)/i.test(url)) return "com.au";
  if (/\.com\/au(\/|$)/i.test(url)) return "com.au";
  if (/\.com(\/|$)/i.test(url)) return "com";
  return null;
}

function isNoiseUrl(url: string): boolean {
  return /linkedin\.com|wikipedia\.org|facebook\.com|instagram\.com|twitter\.com|^https?:\/\/(www\.)?x\.com/i.test(
    url,
  );
}

function extractMetaFromHtml(html: string): { title?: string; description?: string } {
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

  return {
    title: titleMatch?.[1] ? decodeHtmlEntities(titleMatch[1]) : undefined,
    description,
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function readHtmlUntilDescription(res: Response, maxBytes: number): Promise<string> {
  const body = res.body;
  if (!body) {
    const text = await res.text();
    return text.slice(0, maxBytes);
  }

  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let out = "";
  try {
    while (out.length < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
      // Stop once description meta is fully available (content=… present on same tag).
      if (
        /<meta\b[^>]*(?:name|property)=["'](?:description|og:description)["'][^>]*\bcontent=["'][^"']+["']/i.test(
          out,
        ) ||
        /<meta\b[^>]*\bcontent=["'][^"']+["'][^>]*(?:name|property)=["'](?:description|og:description)["']/i.test(
          out,
        )
      ) {
        break;
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }
  return out.slice(0, maxBytes);
}

async function fetchSiteMeta(url: string): Promise<SearchHit | null> {
  const res = await fetchWithTimeout(
    url,
    { redirect: "follow", headers: BROWSER_HEADERS },
    SITE_TIMEOUT_MS,
  );
  if (!res?.ok) return null;
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  if (type && !type.includes("text/html") && !type.includes("application/xhtml")) return null;

  const text = await readHtmlUntilDescription(res, SITE_HTML_CAP);
  if (text.length < 200) return null;
  const meta = extractMetaFromHtml(text);
  if (!meta.description?.trim()) return null;

  return {
    snippet: meta.description.trim(),
    url: normalizeWebsiteUrl(res.url),
    title: meta.title,
    source: "website",
  };
}

async function fetchGoogleCustomSearch(query: string): Promise<SearchHit | null> {
  const apiKey = process.env.GOOGLE_CSE_API_KEY?.trim();
  const cx = process.env.GOOGLE_CSE_CX?.trim();
  if (!apiKey || !cx) return null;

  const params = new URLSearchParams({ key: apiKey, cx, q: query, num: "3" });
  const res = await fetchWithTimeout(
    `https://customsearch.googleapis.com/customsearch/v1?${params}`,
    { headers: { Accept: "application/json" } },
    SEARCH_TIMEOUT_MS,
  );
  if (!res?.ok) return null;

  const data = (await res.json()) as {
    items?: { link?: string; snippet?: string; title?: string }[];
  };
  const item = (data.items ?? []).find((row) => row.snippet?.trim());
  if (!item?.snippet) return null;

  return {
    snippet: item.snippet.trim(),
    url: item.link,
    title: item.title?.trim(),
    source: "google",
  };
}

async function fetchBraveSearchSnippet(query: string): Promise<SearchHit | null> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY?.trim();
  if (!apiKey) return null;

  const params = new URLSearchParams({
    q: query,
    count: "3",
    country: "AU",
    search_lang: "en",
  });
  const res = await fetchWithTimeout(
    `https://api.search.brave.com/res/v1/web/search?${params}`,
    {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      },
    },
    SEARCH_TIMEOUT_MS,
  );
  if (!res?.ok) return null;

  const data = (await res.json()) as {
    web?: { results?: { title?: string; url?: string; description?: string }[] };
  };
  const row = (data.web?.results ?? []).find((item) => item.description?.trim());
  if (!row?.description) return null;

  return {
    title: row.title?.trim(),
    url: row.url,
    snippet: stripHtmlTags(row.description.trim()),
    source: "search",
  };
}

/** First successful snippet wins. */
async function firstHit(tasks: Promise<SearchHit | null>[]): Promise<SearchHit | null> {
  if (!tasks.length) return null;

  return new Promise((resolve) => {
    let pending = tasks.length;
    let settled = false;

    for (const task of tasks) {
      void task.then(
        (hit) => {
          if (!settled && hit?.snippet) {
            settled = true;
            resolve(hit);
            return;
          }
          pending -= 1;
          if (!settled && pending === 0) resolve(null);
        },
        () => {
          pending -= 1;
          if (!settled && pending === 0) resolve(null);
        },
      );
    }
  });
}

function topWebsiteCandidates(companyName: string, slug: string): string[] {
  const urls = [
    ...new Set(companySlugCandidates(companyName, slug).flatMap((s) => candidateWebsiteUrls(s))),
  ];
  // Prefer AU-facing hosts; race at most two.
  const preferred = [
    ...urls.filter((url) => /\/au\/?$/i.test(url)),
    ...urls.filter((url) => /\.com\.au\/?$/i.test(url)),
  ];
  const deduped = [...new Set(preferred.length ? preferred : urls)];
  return deduped.slice(0, 2);
}

export type CompanySummaryResult = {
  companyName: string;
  slug: string;
  websiteUrl: string | null;
  title: string | null;
  summary: string | null;
  googleSearchUrl: string;
  found: boolean;
  tld: string | null;
  source: "website" | "google" | "search" | "none";
};

export async function buildCompanySummary(
  slug: string,
  name: string,
): Promise<CompanySummaryResult> {
  const companyName = name.trim() || slug;
  const cacheKey = `${slug}|${companyName.toLowerCase()}`;
  const cached = summaryCache.get(cacheKey);
  if (cached) {
    const ttl = cached.value.found ? CACHE_TTL_MS : MISS_CACHE_TTL_MS;
    if (Date.now() - cached.at < ttl) return cached.value;
  }

  const searchUrl = googleSearchUrl(`${companyName} company`);
  const query = `${companyName} company`;

  const hit = await firstHit([
    fetchGoogleCustomSearch(query),
    fetchBraveSearchSnippet(query),
    ...topWebsiteCandidates(companyName, slug).map((url) => fetchSiteMeta(url)),
  ]);

  const websiteUrl =
    hit?.url && !isNoiseUrl(hit.url) ? normalizeWebsiteUrl(hit.url) : null;

  const result: CompanySummaryResult = hit?.snippet
    ? {
        companyName,
        slug,
        websiteUrl,
        title: hit.title ?? null,
        summary: simplifySummary(hit.snippet),
        googleSearchUrl: searchUrl,
        found: true,
        tld: detectTld(websiteUrl),
        source: hit.source,
      }
    : {
        companyName,
        slug,
        websiteUrl: null,
        title: null,
        summary: null,
        googleSearchUrl: searchUrl,
        found: false,
        tld: null,
        source: "none",
      };

  summaryCache.set(cacheKey, { at: Date.now(), value: result });
  return result;
}
