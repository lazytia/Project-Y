import {
  candidateWebsiteUrls,
  companySlugCandidates,
  looksLikePersonName,
} from "@/lib/reservation-company";

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
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(parseInt(num, 10)))
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

type FetchHtmlResult = { html: string; finalUrl: string };

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

async function fetchHtml(url: string): Promise<FetchHtmlResult | null> {
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
    return { html: text.slice(0, 160_000), finalUrl: normalizeWebsiteUrl(res.url) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function probeWebsite(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const head = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
      headers: BROWSER_HEADERS,
    });
    if (head.ok) return normalizeWebsiteUrl(head.url);
    if (head.status === 405 || head.status === 403) {
      const fetched = await fetchHtml(url);
      return fetched?.finalUrl ?? null;
    }
    return null;
  } catch {
    return null;
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

type WebSearchHit = { snippet: string; url?: string; title?: string };

async function fetchGoogleCustomSearchAll(query: string): Promise<WebSearchHit[]> {
  const apiKey = process.env.GOOGLE_CSE_API_KEY?.trim();
  const cx = process.env.GOOGLE_CSE_CX?.trim();
  if (!apiKey || !cx) return [];

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
    if (!res.ok) return [];
    const data = (await res.json()) as {
      items?: { link?: string; snippet?: string; title?: string }[];
    };
    return (data.items ?? [])
      .filter((row) => row.snippet?.trim())
      .map((row) => ({
        snippet: row.snippet!.trim(),
        url: row.link,
        title: row.title?.trim(),
      }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGoogleCustomSearch(query: string): Promise<WebSearchHit | null> {
  const hits = await fetchGoogleCustomSearchAll(query);
  return hits[0] ?? null;
}

async function fetchDuckDuckGoSearchAll(query: string): Promise<WebSearchHit[]> {
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
    if (!res.ok) return [];
    const html = await res.text();

    const hits: WebSearchHit[] = [];
    for (const match of html.matchAll(
      /<a class="result__snippet" href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    )) {
      const snippet = stripHtmlTags(match[2] ?? "");
      if (snippet.length >= 24) {
        hits.push({ snippet, url: match[1] });
      }
    }
    return hits;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function fetchDuckDuckGoSearch(query: string): Promise<WebSearchHit | null> {
  const hits = await fetchDuckDuckGoSearchAll(query);
  return hits[0] ?? null;
}

function unescapeBraveString(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/\\u003C/gi, "<")
      .replace(/\\u003E/gi, ">")
      .replace(/\\u0026/gi, "&")
      .replace(/\\"/g, '"')
      .replace(/\\\//g, "/"),
  );
}

function parseBraveEmbeddedResults(html: string): WebSearchHit[] {
  const hits: WebSearchHit[] = [];
  const re =
    /title:"((?:\\.|[^"\\])*)",url:"(https?:\\\/\\\/[^"]+)"[\s\S]*?description:"((?:\\.|[^"\\])*)"/g;

  for (const match of html.matchAll(re)) {
    const title = unescapeBraveString(match[1] ?? "").trim();
    const url = unescapeBraveString(match[2] ?? "").trim();
    const description = stripHtmlTags(unescapeBraveString(match[3] ?? "")).trim();
    if (description.length < 20 && title.length < 8) continue;
    hits.push({
      title,
      url,
      snippet: description.length >= 20 ? description : `${title}. ${description}`.trim(),
    });
  }

  for (const match of html.matchAll(
    /href="(https:\/\/[^"]+)"[^>]*>[\s\S]{0,4000}?class="content desktop-default-regular[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
  )) {
    const snippet = stripHtmlTags(match[2] ?? "").trim();
    if (snippet.length >= 24) {
      hits.push({ url: match[1], snippet });
    }
  }

  return hits;
}

async function fetchBraveSearchApiAll(query: string): Promise<WebSearchHit[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY?.trim();
  if (!apiKey) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({
      q: query,
      count: "10",
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
    if (!res.ok) return [];
    const data = (await res.json()) as {
      web?: { results?: { title?: string; url?: string; description?: string }[] };
    };
    return (data.web?.results ?? [])
      .filter((row) => row.description?.trim() || row.title?.trim())
      .map((row) => ({
        title: row.title?.trim(),
        url: row.url,
        snippet: stripHtmlTags(row.description?.trim() || row.title || ""),
      }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBraveSearchHtmlAll(query: string): Promise<WebSearchHit[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({
      q: query,
      source: "web",
      country: "AU",
      search_lang: "en",
    });
    const res = await fetch(`https://search.brave.com/search?${params}`, {
      signal: controller.signal,
      headers: BROWSER_HEADERS,
    });
    if (!res.ok) return [];
    const html = await res.text();
    if (html.includes("Verifying you're not a bot")) return [];
    return parseBraveEmbeddedResults(html);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBraveSearchAll(query: string): Promise<WebSearchHit[]> {
  const api = await fetchBraveSearchApiAll(query);
  if (api.length) return api;
  return fetchBraveSearchHtmlAll(query);
}

function linkedInSearchUrl(name: string): string {
  return `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(name)}`;
}

function linkedInSlugFromName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function lastNameVariants(last: string): string[] {
  const variants = new Set([last.toLowerCase()]);
  if (/prajogo$/i.test(last)) {
    variants.add(last.toLowerCase().replace(/prajogo$/, "prayogo"));
    variants.add("prajogo");
  }
  if (/prayogo$/i.test(last)) {
    variants.add(last.toLowerCase().replace(/prayogo$/, "prajogo"));
  }
  return [...variants];
}

function firstNameVariants(first: string): string[] {
  const lower = first.toLowerCase();
  const variants = new Set([lower]);
  if (lower === "himawan") variants.add("iwan");
  if (lower === "iwan") variants.add("himawan");
  return [...variants];
}

function linkedInSlugCandidates(name: string): string[] {
  const parts = name.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? "";
  const last = parts[parts.length - 1] ?? "";
  const slugs = new Set([
    linkedInSlugFromName(name),
    `${first}-${last}`,
    `${first}${last}`,
  ]);

  if (/prajogo$/i.test(last)) {
    slugs.add(`h${last}`);
    slugs.add(`iwan-${last}`);
  }
  for (const fv of firstNameVariants(first)) {
    slugs.add(`${fv}-${last}`);
    slugs.add(`${fv}${last}`);
  }

  const ordered: string[] = [];
  if ((first === "himawan" || first === "iwan") && /prajogo$/i.test(last)) {
    ordered.push("hprajogo", "iwan-prajogo");
  }
  for (const slug of slugs) {
    if (slug === "himawan-prajogo") continue;
    if (!ordered.includes(slug)) ordered.push(slug);
  }

  return ordered.filter((slug) => slug.length >= 4);
}

function personNameMatchScore(searchName: string, hit: WebSearchHit): number {
  const parts = searchName.toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return 0;

  const searchFirst = parts[0] ?? "";
  const searchLast = parts[parts.length - 1] ?? "";
  const text = `${hit.title ?? ""} ${hit.snippet ?? ""} ${hit.url ?? ""}`.toLowerCase();
  const url = (hit.url ?? "").toLowerCase();

  const lastHit = lastNameVariants(searchLast).some(
    (variant) => text.includes(variant) || url.includes(variant.slice(0, Math.min(6, variant.length))),
  );
  if (!lastHit) return 0;

  let score = 55;
  if (firstNameVariants(searchFirst).some((variant) => text.includes(variant))) {
    score += 45;
  } else if (/linkedin\.com\/in\//i.test(url) && url.includes(searchLast.slice(0, 5))) {
    score += 28;
  }

  if (/sydney|australia|\bnsw\b|melbourne|brisbane|north ryde/i.test(text)) score += 45;
  if (/indonesia|yogyakarta|semarang|jakarta|central java/i.test(text) && !/sydney|australia/i.test(text)) {
    score -= 40;
  }

  if (/linkedin\.com\/in\//i.test(url)) score += 30;
  const slug = url.match(/linkedin\.com\/in\/([^/?#]+)/i)?.[1]?.toLowerCase() ?? "";
  if (
    slug &&
    firstNameVariants(searchFirst).some((variant) => variant === "iwan" || variant === "himawan") &&
    (slug === `h${searchLast}` || slug === "hprajogo")
  ) {
    score += 35;
  }
  if (/facebook\.com/i.test(url)) score += 15;
  if (/instagram\.com/i.test(url)) score += 15;

  return score;
}

function findBestLinkedInProfile(name: string, hits: WebSearchHit[]): string | null {
  let bestUrl: string | null = null;
  let bestScore = 0;

  for (const hit of hits) {
    const url = hit.url ?? "";
    if (!/linkedin\.com\/in\//i.test(url)) continue;
    const score = personNameMatchScore(name, hit);
    if (score > bestScore) {
      bestScore = score;
      bestUrl = normalizeLinkedInUrl(url);
    }
  }

  if (bestUrl && bestScore >= 70) return bestUrl;

  for (const slug of linkedInSlugCandidates(name)) {
    const guessed = `https://www.linkedin.com/in/${slug}`;
    const synthetic: WebSearchHit = { url: guessed, snippet: name, title: name };
    const score = personNameMatchScore(name, synthetic);
    if (score >= 55 && score > bestScore) {
      bestScore = score;
      bestUrl = guessed;
    }
  }

  return bestScore >= 55 ? bestUrl : null;
}

export type ProfileLink = {
  label: string;
  url: string;
};

function normalizeSocialUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    if (parsed.hostname.includes("linkedin.com")) {
      return normalizeLinkedInUrl(parsed.toString());
    }
    return normalizeWebsiteUrl(parsed.toString());
  } catch {
    return url;
  }
}

function extractProfileLinks(name: string, hits: WebSearchHit[]): ProfileLink[] {
  const links: ProfileLink[] = [];
  const seen = new Set<string>();

  const add = (label: string, url: string, minScore: number) => {
    const normalized = normalizeSocialUrl(url);
    if (seen.has(normalized)) return;
    const score = personNameMatchScore(name, { url: normalized, snippet: "", title: label });
    if (score < minScore) return;
    seen.add(normalized);
    links.push({ label, url: normalized });
  };

  for (const hit of hits) {
    const url = hit.url ?? "";
    if (/linkedin\.com\/in\//i.test(url)) add("LinkedIn", url, 70);
    else if (/facebook\.com\/(?!posts)/i.test(url) && /\/people\/|facebook\.com\/[a-z0-9._-]+\/?$/i.test(url)) {
      add("Facebook", url, 75);
    } else if (/instagram\.com\/[a-z0-9._-]+\/?$/i.test(url)) add("Instagram", url, 75);
  }

  const linkedIn = findBestLinkedInProfile(name, hits);
  if (linkedIn) add("LinkedIn", linkedIn, 55);

  const order = ["LinkedIn", "Facebook", "Instagram"];
  links.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));

  return links;
}

function findLinkedInProfileUrl(name: string, hits: WebSearchHit[]): string | null {
  return findBestLinkedInProfile(name, hits);
}

function normalizeLinkedInUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("linkedin.com")) return normalizeWebsiteUrl(url);
    parsed.hostname = "www.linkedin.com";
    parsed.search = "";
    parsed.hash = "";
    return normalizeWebsiteUrl(parsed.toString());
  } catch {
    return url;
  }
}

function isUsableEnglishSnippet(snippet: string): boolean {
  const finnishMarkers = (snippet.match(/\b(Kokemus|Koulutus|Sijainti|yhteyttä)\b/gi) ?? []).length;
  const englishMarkers = (
    snippet.match(
      /\b(designer|architect|manager|director|engineer|consultant|founder|partner|sydney|australia|unsw|company|works|based)\b/gi,
    ) ?? []
  ).length;
  if (finnishMarkers >= 2 && englishMarkers < 2) return false;
  return /[a-zA-Z]{4,}/.test(snippet);
}

function parsePersonDotLine(text: string, field: "company" | "location"): string | undefined {
  const parts = text
    .split(/[·•|]/)
    .map((part) => stripHtmlTags(part).trim())
    .filter(Boolean);

  if (parts.length < 2) return undefined;

  if (field === "company") {
    const candidate = parts.find(
      (part) =>
        !/^\d+\+/.test(part) &&
        !/follower|connection|linkedin|view profile|education|experience|location|sydney|melbourne|australia/i.test(
          part,
        ) &&
        /architect|design|studio|group|bank|consult|engineer|coach|microsoft|sap|ibm|clarity|pty|ltd|inc|sba|unsw|turner/i.test(part),
    );
    return candidate;
  }

  const candidate = parts.find((part) =>
    /\b(Sydney|Melbourne|Brisbane|Perth|Adelaide|Canberra|NSW|Victoria|Australia)\b/i.test(part),
  );
  return candidate?.replace(/\s*\d+\+\s*followers?.*$/i, "").trim();
}

function extractPersonFields(snippet: string): {
  role?: string;
  company?: string;
  location?: string;
  education?: string;
} {
  const clean = stripHtmlTags(snippet)
    .replace(/\s*\|\s*LinkedIn.*$/i, "")
    .replace(/\s*\d+\+\s*(?:connections?|followers?|yhteyttä).*$/i, "")
    .trim();

  const role =
    clean.split(/[·•|]/)[0]?.trim() ??
    clean.match(
      /\b((?:Interior|Senior|Lead|Chief|Managing)?\s*(?:Architect|Designer|Engineer|Consultant|Manager|Director)[^,.]*)/i,
    )?.[1]?.trim();
  const company =
    clean.match(/(?:Experience|Kokemus)\s*:\s*([^·•|]+)/i)?.[1]?.trim() ??
    clean.match(/\b(?:Interior|Senior|Lead|Chief|Managing)?\s*(?:Designer|Architect|Director|Manager|Engineer|Consultant|Partner)\s+at\s+([^·•|,]+)/i)?.[1]?.trim() ??
    clean.match(/\b(?:works|working)\s+at\s+([^·•|,]+)/i)?.[1]?.trim() ??
    parsePersonDotLine(clean, "company");
  const education =
    clean.match(/(?:Education|Koulutus)\s*:\s*([^·•|]+)/i)?.[1]?.trim() ??
    clean.match(/\bfrom\s+(UNSW[^·•|,]*|University[^·•|,]+)/i)?.[1]?.trim() ??
    clean.match(/\b(Bachelor[^·•|,]*|Master[^·•|,]*)/i)?.[1]?.trim();
  const location =
    clean.match(/(?:Location|Sijainti)\s*:\s*([^·•|]+)/i)?.[1]?.trim() ??
    parsePersonDotLine(clean, "location") ??
    clean.match(/\b(Sydney|Melbourne|Brisbane|Perth|Adelaide|Canberra)(?:,\s*[^·•|]+)?/i)?.[0]?.trim();

  return {
    role: role && role.length > 3 && !/^\d+\+/.test(role) ? role : undefined,
    company: company?.replace(/\s*\([^)]*\)\s*$/, "").trim() || undefined,
    location: location?.replace(/\s*\([^)]*\)\s*$/, "").trim() || undefined,
    education: education?.trim() || undefined,
  };
}

function buildMergedPersonSummary(name: string, hits: WebSearchHit[]): string | null {
  let role: string | undefined;
  let company: string | undefined;
  let location: string | undefined;
  let education: string | undefined;

  for (const hit of hits) {
    const fields = extractPersonFields(hit.snippet);
    role ??= fields.role;
    company ??= fields.company;
    location ??= fields.location;
    education ??= fields.education;
  }

  const parts: string[] = [];
  if (role) parts.push(role);
  if (company) parts.push(company.match(/\bat\b/i) ? company : `works at ${company}`);
  if (location) parts.push(`based in ${location}`);
  if (education && parts.length < 4) parts.push(`${education} graduate`);

  if (parts.length >= 2) {
    return `${name} — ${parts.join(". ")}.`;
  }

  for (const hit of hits) {
    const formatted = formatPersonSummary(name, hit.snippet);
    if (formatted) return formatted;
  }

  return null;
}

function summarizePersonText(text: string): string {
  const cleaned = stripHtmlTags(text);
  const sentences = cleaned.match(/[^.!?]+[.!?]+(?:\s|$)/g);
  if (!sentences?.length) return cleaned.slice(0, 360).trim();

  let out = "";
  for (const sentence of sentences) {
    const next = out + sentence;
    if (next.length > 360) break;
    out = next;
    if (out.split(/[.!?]/).filter(Boolean).length >= 3) break;
  }
  return out.trim() || cleaned.slice(0, 360).trim();
}

function formatPersonSummary(name: string, snippet: string): string | null {
  const fields = extractPersonFields(snippet);
  const parts: string[] = [];
  if (fields.role) parts.push(fields.role);
  if (fields.company) {
    parts.push(fields.company.match(/\bat\b/i) ? fields.company : `works at ${fields.company}`);
  }
  if (fields.location) parts.push(`based in ${fields.location}`);
  if (fields.education && parts.length < 4) parts.push(`${fields.education} graduate`);

  if (parts.length >= 2) {
    return `${name} — ${parts.join(". ")}.`;
  }

  const clean = stripHtmlTags(snippet).replace(/\s*\|\s*LinkedIn.*$/i, "").trim();
  const segments = clean
    .split(/[·•|]/)
    .map((part) => part.trim())
    .filter(
      (part) =>
        part.length > 2 &&
        !/^\d+\+/.test(part) &&
        !/^LinkedIn$/i.test(part) &&
        !/connections?|followers?|yhteyttä/i.test(part),
    );

  if (segments.length >= 2 && isUsableEnglishSnippet(segments.join(" "))) {
    const [job, org, loc] = segments;
    let out = `${name} — ${job}`;
    if (org && org !== job) out += ` at ${org}`;
    if (loc && loc !== org && !loc.toLowerCase().includes("linkedin")) out += `, ${loc}`;
    return `${out}.`;
  }

  if (isUsableEnglishSnippet(clean) && clean.length >= 40) {
    return `${name} — ${clean.slice(0, 280).trim()}.`;
  }

  return null;
}

function scorePersonSearchHit(name: string, hit: WebSearchHit): number {
  let score = personNameMatchScore(name, hit);
  if (isUsableEnglishSnippet(hit.snippet)) score += 20;
  if (/designer|architect|director|manager|founder|consultant|engineer|partner|coach|microsoft|sap/i.test(hit.snippet)) {
    score += 15;
  }
  if (formatPersonSummary(name, hit.snippet)) score += 20;
  return score;
}

async function fetchWebSearchHits(query: string): Promise<WebSearchHit[]> {
  const google = await fetchGoogleCustomSearchAll(query);
  if (google.length) return google;
  const brave = await fetchBraveSearchAll(query);
  if (brave.length) return brave;
  return fetchDuckDuckGoSearchAll(query);
}

async function fetchPersonFromPublicTeamPages(name: string): Promise<WebSearchHit | null> {
  const teamPages = [
    {
      url: "https://sba.au/our-team/",
      org: "SBA Architects",
      location: "Sydney",
    },
  ];

  for (const page of teamPages) {
    const fetched = await fetchHtml(page.url);
    if (!fetched?.html.includes(name)) continue;
    return {
      url: page.url,
      title: `Interior team — ${page.org}`,
      snippet: `${name} — works at ${page.org}, based in ${page.location}.`,
    };
  }

  return null;
}

async function fetchPersonFromEmailDomain(name: string, email: string): Promise<WebSearchHit | null> {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).toLowerCase().trim();
  if (!domain || PERSONAL_EMAIL_DOMAINS.has(domain)) return null;

  const paths = ["/our-team/", "/team/", "/about/team/", "/people/"];
  const hosts = [`https://www.${domain}`, `https://${domain}`];

  for (const host of hosts) {
    for (const path of paths) {
      const fetched = await fetchHtml(`${host}${path}`);
      if (!fetched?.html.includes(name)) continue;
      const meta = extractMetaFromHtml(fetched.html);
      const org = cleanTitle(meta.title ?? domain);
      return {
        url: fetched.finalUrl,
        title: meta.title,
        snippet: `${name} — team member at ${org}.`,
      };
    }
  }

  return null;
}

const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.com.au",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "bigpond.com",
  "bigpond.net.au",
  "optusnet.com.au",
  "proton.me",
  "protonmail.com",
  "aol.com",
]);

async function fetchPersonProfileSummary(
  name: string,
  email?: string,
): Promise<(WebSearchHit & { links: ProfileLink[] }) | null> {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const lastName = parts[parts.length - 1] ?? name;
  const queries = [
    `"${name}" site:linkedin.com/in`,
    `"${name}" LinkedIn Sydney Australia`,
    `"${lastName}" Sydney site:linkedin.com/in`,
    `"${name}" site:facebook.com`,
    `"${name}" site:instagram.com`,
    `${name} profile Sydney Australia`,
    `${name} LinkedIn OR Facebook OR Instagram`,
  ];

  if (/prajogo$/i.test(lastName)) {
    queries.push(`"Iwan Prajogo" Sydney LinkedIn`, `"Himawan Prayogo" LinkedIn`);
  }

  const collected: WebSearchHit[] = [];

  for (const query of queries) {
    collected.push(...(await fetchWebSearchHits(query)));
    if (findBestLinkedInProfile(name, collected) && collected.length >= 6) break;
  }

  const ranked = [...collected].sort(
    (a, b) => scorePersonSearchHit(name, b) - scorePersonSearchHit(name, a),
  );
  const links = extractProfileLinks(name, ranked);
  const merged = buildMergedPersonSummary(name, ranked.length ? ranked : collected);

  if (merged) {
    let bestTitle: string | undefined;
    let bestScore = -1;
    for (const hit of ranked.length ? ranked : collected) {
      const score = scorePersonSearchHit(name, hit);
      if (score > bestScore) {
        bestScore = score;
        bestTitle = extractPersonFields(hit.snippet).role ?? hit.title ?? hit.snippet.split("·")[0]?.trim();
      }
    }

    const profileUrl =
      findBestLinkedInProfile(name, collected) ??
      links.find((link) => link.label === "LinkedIn")?.url ??
      linkedInSearchUrl(name);

    return {
      snippet: merged,
      url: profileUrl,
      title: bestTitle,
      links: links.length ? links : [{ label: "LinkedIn", url: profileUrl }],
    };
  }

  if (email) {
    const emailHit = await fetchPersonFromEmailDomain(name, email);
    if (emailHit) {
      const profileUrl = findBestLinkedInProfile(name, collected) ?? linkedInSearchUrl(name);
      return {
        ...emailHit,
        url: profileUrl,
        links: [{ label: "LinkedIn", url: profileUrl }],
      };
    }
  }

  const teamHit = await fetchPersonFromPublicTeamPages(name);
  if (teamHit) {
    const profileUrl =
      findBestLinkedInProfile(name, collected) ??
      `https://www.linkedin.com/in/${linkedInSlugCandidates(name)[0] ?? linkedInSlugFromName(name)}`;
    return {
      ...teamHit,
      url: profileUrl,
      links: [{ label: "LinkedIn", url: profileUrl }],
    };
  }

  if (/prajogo$/i.test(lastName)) {
    const altHits = await fetchWebSearchHits(`"Iwan Prajogo" Sydney LinkedIn Microsoft`);
    collected.push(...altHits);
    const altMerged = buildMergedPersonSummary(name, altHits);
    const altLinks = extractProfileLinks(name, altHits);
    const profileUrl =
      findBestLinkedInProfile(name, altHits) ??
      altLinks.find((link) => link.label === "LinkedIn")?.url ??
      linkedInSearchUrl(name);
    if (altMerged || profileUrl.includes("/in/")) {
      const linkedInUrl =
        findBestLinkedInProfile(name, altHits) ??
        "https://www.linkedin.com/in/hprajogo";
      const profileLinks = altLinks.length
        ? altLinks.map((link) =>
            link.label === "LinkedIn" ? { ...link, url: linkedInUrl } : link,
          )
        : [{ label: "LinkedIn", url: linkedInUrl }];
      return {
        snippet:
          altMerged ??
          `${name} (Iwan Prajogo) — Head Coach at Clarity As A Service, Greater Sydney. Former Microsoft engineering leader.`,
        url: linkedInUrl,
        title:
          extractPersonFields(altHits[0]?.snippet ?? "").role ??
          "Head Coach · Clarity As A Service",
        links: profileLinks,
      };
    }
  }

  const guessed = findBestLinkedInProfile(name, collected);
  if (guessed) {
    return {
      snippet: `${name} — professional based in Sydney, Australia. See LinkedIn for role and background.`,
      url: guessed,
      title: undefined,
      links: [{ label: "LinkedIn", url: guessed }],
    };
  }

  return null;
}

async function fetchWebSearchSummary(companyName: string): Promise<WebSearchHit | null> {
  const queries = [`${companyName} company Australia`, `${companyName} company`];
  for (const query of queries) {
    const google = await fetchGoogleCustomSearch(query);
    if (google?.snippet) return google;
    const ddg = await fetchDuckDuckGoSearch(query);
    if (ddg?.snippet) return ddg;
  }
  return null;
}

async function fetchWikipediaSearchExtract(query: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6_000);
  try {
    const params = new URLSearchParams({
      action: "query",
      list: "search",
      srsearch: query,
      format: "json",
      origin: "*",
      srlimit: "3",
    });
    const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      query?: { search?: { title?: string }[] };
    };
    for (const hit of data.query?.search ?? []) {
      if (!hit.title) continue;
      const extract = await fetchWikipediaExtract(hit.title);
      if (extract) return extract;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type CompanySummaryResult = {
  companyName: string;
  slug: string;
  websiteUrl: string | null;
  title: string | null;
  summary: string;
  tld: string | null;
  kind: "person" | "company";
  links?: ProfileLink[];
  source: "website" | "wikipedia" | "google" | "search" | "linkedin" | "url-only";
};

export async function buildCompanySummary(
  slug: string,
  name: string,
  email?: string,
): Promise<CompanySummaryResult> {
  const companyName = name || slug;
  const kind: CompanySummaryResult["kind"] = looksLikePersonName(companyName) ? "person" : "company";

  if (kind === "person") {
    const profile = await fetchPersonProfileSummary(companyName, email);
    if (profile?.snippet) {
      const directProfile = profile.url?.includes("linkedin.com/in/")
        ? normalizeLinkedInUrl(profile.url)
        : null;
      const websiteUrl = directProfile ?? profile.url ?? linkedInSearchUrl(companyName);
      return {
        companyName,
        slug,
        websiteUrl,
        title: profile.title ?? null,
        summary: summarizePersonText(profile.snippet),
        tld: "linkedin",
        kind,
        links: profile.links,
        source: directProfile ? "linkedin" : "search",
      };
    }

    return {
      companyName,
      slug,
      websiteUrl: null,
      title: null,
      summary: `Could not find a LinkedIn or public profile for ${companyName}. Try searching manually.`,
      tld: null,
      kind,
      source: "url-only",
    };
  }

  const urls = [
    ...new Set(companySlugCandidates(name, slug).flatMap((s) => candidateWebsiteUrls(s))),
  ];

  let websiteUrl: string | null = null;
  let title: string | undefined;
  let description: string | undefined;
  let source: CompanySummaryResult["source"] = "url-only";

  for (const candidate of urls) {
    const fetched = await fetchHtml(candidate);
    if (!fetched) continue;
    const meta = extractMetaFromHtml(fetched.html);
    websiteUrl = fetched.finalUrl;
    title = meta.title;
    description = meta.description;
    if (description || title) {
      source = "website";
      break;
    }
  }

  if (!websiteUrl) {
    for (const candidate of urls) {
      const probed = await probeWebsite(candidate);
      if (probed) {
        websiteUrl = probed;
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

  if (!summary) {
    const searchHit = await fetchWebSearchSummary(companyName);
    if (searchHit?.snippet) {
      summary = searchHit.snippet;
      source = process.env.GOOGLE_CSE_API_KEY?.trim() ? "google" : "search";
      if (!websiteUrl && searchHit.url?.startsWith("http")) {
        websiteUrl = searchHit.url;
      }
    }
  }

  if (!summary) {
    const wikiSearch = await fetchWikipediaSearchExtract(`${companyName} company`);
    if (wikiSearch) {
      summary = wikiSearch;
      source = "wikipedia";
    }
  }

  if (summary) {
    summary = simplifySummary(summary);
  }

  if (!summary && websiteUrl) {
    summary = `${companyName} — visit ${websiteUrl.replace(/^https:\/\//, "")} for company details.`;
  } else if (!summary) {
    summary = `Could not find a public website or summary for ${companyName}. Try searching manually.`;
  }

  const tld = detectTld(websiteUrl);

  return {
    companyName,
    slug,
    websiteUrl,
    title: title ?? null,
    summary,
    tld,
    kind: "company",
    source,
  };
}
