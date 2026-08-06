import {
  candidateWebsiteUrls,
  companySlugCandidates,
} from "@/lib/reservation-company";

const FETCH_TIMEOUT_MS = 10_000;

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

async function fetchHtml(url: string): Promise<{ html: string; finalUrl: string } | null> {
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
    return { html: text.slice(0, 120_000), finalUrl: normalizeWebsiteUrl(res.url) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type SearchHit = { snippet: string; url?: string; title?: string };

async function fetchGoogleCustomSearch(query: string): Promise<SearchHit | null> {
  const apiKey = process.env.GOOGLE_CSE_API_KEY?.trim();
  const cx = process.env.GOOGLE_CSE_CX?.trim();
  if (!apiKey || !cx) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({
      key: apiKey,
      cx,
      q: query,
      num: "5",
    });
    const res = await fetch(`https://customsearch.googleapis.com/customsearch/v1?${params}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      items?: { link?: string; snippet?: string; title?: string }[];
    };
    const item = (data.items ?? []).find((row) => row.snippet?.trim());
    if (!item?.snippet) return null;
    return {
      snippet: item.snippet.trim(),
      url: item.link,
      title: item.title?.trim(),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchDuckDuckGoSnippet(query: string): Promise<SearchHit | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch("https://html.duckduckgo.com/html/", {
      method: "POST",
      signal: controller.signal,
      headers: {
        ...BROWSER_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `q=${encodeURIComponent(query)}`,
    });
    if (!res.ok) return null;
    const html = await res.text();
    for (const match of html.matchAll(
      /<a class="result__snippet" href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    )) {
      const snippet = stripHtmlTags(match[2] ?? "");
      if (snippet.length >= 24) {
        return { snippet, url: match[1] };
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBraveSearchSnippet(query: string): Promise<SearchHit | null> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY?.trim();
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({
      q: query,
      count: "5",
      country: "AU",
      search_lang: "en",
    });
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      web?: { results?: { title?: string; url?: string; description?: string }[] };
    };
    const row = (data.web?.results ?? []).find((item) => item.description?.trim());
    if (!row?.description) return null;
    return {
      title: row.title?.trim(),
      url: row.url,
      snippet: stripHtmlTags(row.description.trim()),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isNoiseUrl(url: string): boolean {
  return /linkedin\.com|wikipedia\.org|facebook\.com|instagram\.com|twitter\.com|^https?:\/\/(www\.)?x\.com/i.test(
    url,
  );
}

async function searchCompanySnippet(companyName: string): Promise<SearchHit | null> {
  const queries = [`${companyName} company Australia`, `${companyName} company`, companyName];

  for (const query of queries) {
    const google = await fetchGoogleCustomSearch(query);
    if (google?.snippet) return google;

    const brave = await fetchBraveSearchSnippet(query);
    if (brave?.snippet) return brave;

    const ddg = await fetchDuckDuckGoSnippet(query);
    if (ddg?.snippet) return ddg;
  }

  return null;
}

async function tryOfficialWebsite(
  companyName: string,
  slug: string,
): Promise<{ url: string; summary?: string; title?: string } | null> {
  const urls = [
    ...new Set(companySlugCandidates(companyName, slug).flatMap((s) => candidateWebsiteUrls(s))),
  ];

  for (const candidate of urls) {
    const fetched = await fetchHtml(candidate);
    if (!fetched) continue;
    const meta = extractMetaFromHtml(fetched.html);
    return {
      url: fetched.finalUrl,
      summary: meta.description,
      title: meta.title,
    };
  }
  return null;
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
  const searchUrl = googleSearchUrl(`${companyName} company`);

  const site = await tryOfficialWebsite(companyName, slug);
  if (site?.summary) {
    return {
      companyName,
      slug,
      websiteUrl: site.url,
      title: site.title ?? null,
      summary: simplifySummary(site.summary),
      googleSearchUrl: searchUrl,
      found: true,
      tld: detectTld(site.url),
      source: "website",
    };
  }

  const hit = await searchCompanySnippet(companyName);
  if (hit?.snippet) {
    const websiteUrl =
      hit.url && !isNoiseUrl(hit.url) ? normalizeWebsiteUrl(hit.url) : (site?.url ?? null);
    return {
      companyName,
      slug,
      websiteUrl,
      title: hit.title ?? null,
      summary: simplifySummary(hit.snippet),
      googleSearchUrl: searchUrl,
      found: true,
      tld: detectTld(websiteUrl),
      source: process.env.GOOGLE_CSE_API_KEY?.trim() ? "google" : "search",
    };
  }

  return {
    companyName,
    slug,
    websiteUrl: site?.url ?? null,
    title: null,
    summary: null,
    googleSearchUrl: searchUrl,
    found: false,
    tld: detectTld(site?.url ?? null),
    source: "none",
  };
}
