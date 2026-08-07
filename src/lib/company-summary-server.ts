import { GoogleAuth } from "google-auth-library";
import {
  candidateWebsiteUrls,
  companySlugCandidates,
  looksLikePersonName,
} from "@/lib/reservation-company";

/**
 * Gemini with Google Search grounding writes the summary staff actually see.
 *
 * Guessing a homepage from the company name only works when the domain *is*
 * the name — it could never reach commbank.com.au from "Commonwealth Bank",
 * and retailers like Bunnings block server-side fetches outright. A grounded
 * model resolves the real company and describes it in a sentence or two,
 * which is the whole point of the feature. It also reliably declines when the
 * guest typed their own name, so we no longer guess at that from name shape.
 */
const VERTEX_LOCATION = "global";
const VERTEX_MODEL = "gemini-2.5-flash";
const VERTEX_TIMEOUT_MS = 9_000;

const SITE_TIMEOUT_MS = 2_800;
const SITE_HTML_CAP = 200_000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const MISS_CACHE_TTL_MS = 30_000;
/**
 * How many guessed website URLs to race when no search API key is set.
 * These all fire in parallel and resolve via firstHit, so the wall-clock
 * cost is one SITE_TIMEOUT_MS regardless of the count — capping it low only
 * loses coverage. At 4 the bare ".com" variants fell off the end, which is
 * where global brands like Rio Tinto and Canva actually live.
 */
const WEBSITE_PROBE_LIMIT = 8;

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
  source: "website";
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

/** Does this result's host actually belong to the company we searched for? */
function domainMatchesSlug(url: string, slugs: string[]): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  const label = host.split(".")[0] ?? "";
  return slugs.some((candidate) => candidate.length >= 3 && label === candidate);
}

function extractMetaFromHtml(html: string): { title?: string; description?: string } {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  let description: string | undefined;

  // Pages often carry several description tags — a terse one for social
  // cards and a fuller one for search engines. Taking the first match gave
  // us summaries as useless as just "Atlassian", so prefer the longest.
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const meta = tag[0];
    if (!/(?:name|property)=["'](?:description|og:description)["']/i.test(meta)) continue;
    const content = meta.match(/\bcontent=["']([^"']+)["']/i)?.[1];
    if (!content?.trim()) continue;
    const decoded = decodeHtmlEntities(content);
    if (!description || decoded.length > description.length) description = decoded;
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
      // Every meta tag lives in <head>, so stop there rather than at the
      // first description match — otherwise we'd cut off before a later,
      // fuller description tag that extractMetaFromHtml would prefer.
      if (/<\/head\s*>/i.test(out)) break;
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

type CompanyBrief = {
  isCompany: boolean;
  summary: string;
  industry: string;
  website: string;
};

let googleAuth: GoogleAuth | null = null;
function vertexAuth(): GoogleAuth {
  googleAuth ??= new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  return googleAuth;
}

function buildBriefPrompt(companyName: string): string {
  return [
    "You are briefing a restaurant host about a company on a guest's booking.",
    `Company name on the booking: "${companyName}"`,
    "",
    "Reply with ONLY a JSON object:",
    '{"isCompany":boolean,"summary":string,"industry":string,"website":string}',
    "- isCompany: false if this is a person's name, or if you cannot verify a",
    "  real company by this name. When false, leave the other fields empty.",
    "- summary: at most two short sentences on what the company does. Plain text.",
    "- industry: two or three words.",
    "- website: official homepage URL, or empty string if unsure.",
    "Prefer the Australian entity when one exists.",
  ].join("\n");
}

/** Grounded company brief from Gemini. Returns null if Vertex is unreachable. */
async function fetchCompanyBrief(companyName: string): Promise<CompanyBrief | null> {
  try {
    const auth = vertexAuth();
    const projectId = process.env.GOOGLE_CLOUD_PROJECT?.trim() || (await auth.getProjectId());
    if (!projectId) return null;

    const token = await auth.getAccessToken();
    if (!token) return null;

    const res = await fetchWithTimeout(
      `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${VERTEX_LOCATION}/publishers/google/models/${VERTEX_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: buildBriefPrompt(companyName) }] }],
          tools: [{ googleSearch: {} }],
          generationConfig: {
            temperature: 0.1,
            // Reasoning tokens are billed as output and count against this
            // budget. At 500 with thinking on, "TCS Australia" spent the
            // allowance before finishing the JSON and came back truncated.
            // A two-sentence blurb needs no deliberation, so switch thinking
            // off — that cuts latency and roughly two thirds of the cost.
            maxOutputTokens: 512,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      },
      VERTEX_TIMEOUT_MS,
    );
    if (!res?.ok) return null;

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("");

    // Grounded replies sometimes arrive fenced or with a trailing note, so
    // pull the object out rather than parsing the whole response.
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    if (!json) return null;

    const parsed = JSON.parse(json) as Partial<CompanyBrief>;
    return {
      isCompany: parsed.isCompany === true,
      summary: typeof parsed.summary === "string" ? parsed.summary.trim() : "",
      industry: typeof parsed.industry === "string" ? parsed.industry.trim() : "",
      website: typeof parsed.website === "string" ? parsed.website.trim() : "",
    };
  } catch {
    return null;
  }
}

/**
 * Best successful snippet in *priority* order, not whichever returns first.
 *
 * Every task is already in flight before we start awaiting, so this still
 * costs one timeout of wall-clock time overall — but it resolves
 * deterministically. Racing on arrival order meant a company's Australian
 * site lost to whichever mirror happened to be quicker, which is how
 * "Deloitte" came back as the Korean landing page.
 */
async function firstHit(tasks: Promise<SearchHit | null>[]): Promise<SearchHit | null> {
  for (const task of tasks) {
    const hit = await task.catch(() => null);
    if (hit?.snippet) return hit;
  }
  return null;
}

function topWebsiteCandidates(companyName: string, slug: string): string[] {
  // candidateWebsiteUrls already returns the most-likely-first ordering for
  // AU bookings: .com.au hosts, then global .com/au landing pages, then bare
  // .com. An earlier re-sort here pushed the "/au" *path* variants ahead of
  // the ".com.au" *domains* and then kept only two, so .com.au was never
  // probed at all. These race in parallel via firstHit, so probing a few
  // more candidates costs no extra wall-clock time.
  const urls = [
    ...new Set(companySlugCandidates(companyName, slug).flatMap((s) => candidateWebsiteUrls(s))),
  ];
  return urls.slice(0, WEBSITE_PROBE_LIMIT);
}

export type CompanySummaryResult = {
  companyName: string;
  slug: string;
  websiteUrl: string | null;
  title: string | null;
  summary: string | null;
  industry: string | null;
  googleSearchUrl: string;
  found: boolean;
  tld: string | null;
  source: "gemini" | "website" | "search" | "none";
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
  const slugs = companySlugCandidates(companyName, slug);

  const miss: CompanySummaryResult = {
    companyName,
    slug,
    websiteUrl: null,
    title: null,
    summary: null,
    industry: null,
    googleSearchUrl: searchUrl,
    found: false,
    tld: null,
    source: "none",
  };

  const brief = await fetchCompanyBrief(companyName);
  if (brief) {
    // The model verified the name one way or the other, so trust it — this
    // is also what keeps a guest's own name from being described as if it
    // were their employer.
    if (!brief.isCompany || !brief.summary) {
      summaryCache.set(cacheKey, { at: Date.now(), value: miss });
      return miss;
    }

    const site =
      brief.website && !isNoiseUrl(brief.website) ? normalizeWebsiteUrl(brief.website) : null;
    const result: CompanySummaryResult = {
      companyName,
      slug,
      websiteUrl: site,
      title: null,
      summary: simplifySummary(brief.summary),
      industry: brief.industry || null,
      googleSearchUrl: searchUrl,
      found: true,
      tld: detectTld(site),
      source: "gemini",
    };
    summaryCache.set(cacheKey, { at: Date.now(), value: result });
    return result;
  }

  // Vertex unreachable — fall back to reading the company's own homepage so
  // the feature degrades instead of going dark.
  const hit = await firstHit(
    topWebsiteCandidates(companyName, slug).map((url) => fetchSiteMeta(url)),
  );

  // Social and directory pages are dropped outright: their blurb describes
  // whoever happens to share the name, not the company on this booking.
  if (!hit?.snippet || !hit.url || isNoiseUrl(hit.url)) {
    summaryCache.set(cacheKey, { at: Date.now(), value: miss });
    return miss;
  }

  // Guests sometimes type their own name into the Company field. We still
  // search it — "Rio Tinto" and "Rosie Karkash" are indistinguishable by
  // shape — but for personal-looking names we only trust a result whose
  // domain is actually that name. Otherwise a same-named stranger's page
  // would render as if it described the guest.
  if (looksLikePersonName(companyName) && !domainMatchesSlug(hit.url, slugs)) {
    summaryCache.set(cacheKey, { at: Date.now(), value: miss });
    return miss;
  }

  const websiteUrl = normalizeWebsiteUrl(hit.url);
  const result: CompanySummaryResult = {
    companyName,
    slug,
    websiteUrl,
    title: hit.title ?? null,
    summary: simplifySummary(hit.snippet),
    industry: null,
    googleSearchUrl: searchUrl,
    found: true,
    tld: detectTld(websiteUrl),
    source: hit.source,
  };

  summaryCache.set(cacheKey, { at: Date.now(), value: result });
  return result;
}
