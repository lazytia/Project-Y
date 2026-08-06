/** Resolve a bookable company label + website slug from reservation fields. */

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

export type ResolvedCompany = {
  displayName: string;
  slug: string;
  websiteUrl: string | null;
  kind: "person" | "company";
  source: "company" | "email";
};

const PERSON_NAME_STOPWORDS =
  /\b(and|&|the|services|architects|architecture|consulting|consultants|bank|group|hotel|restaurant|cafe|bar|studio|studios|design|designs|media|tech|technology|solutions|partners|holdings|enterprises|pty|ltd|limited|inc|corp|company|co)\b/i;

/** Two to four name-like words (e.g. Rosie Karkash), not a company label. */
export function looksLikePersonName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed || COMPANY_SUFFIX_RE.test(trimmed) || PERSON_NAME_STOPWORDS.test(trimmed)) {
    return false;
  }
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;
  return words.every((word) => /^[A-Za-z][A-Za-z'-]*$/.test(word));
}

const COMPANY_SUFFIX_RE =
  /\b(pty\.?\s*ltd\.?|pty\.?|ltd\.?|limited|inc\.?|incorporated|corp\.?|corporation|llc|plc|co\.?|company|group|holdings|enterprises|solutions)\b\.?/gi;

function slugifyName(name: string): string {
  return name
    .replace(COMPANY_SUFFIX_RE, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 48);
}

/** Slugs to probe — strips Ltd/Pty etc. from the name when the raw slug misses. */
export function companySlugCandidates(name: string, slug: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of [slugifyName(name), slug]) {
    const safe = candidate.toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (safe.length >= 2 && !seen.has(safe)) {
      seen.add(safe);
      out.push(safe);
    }
  }
  return out;
}

function titleCaseSlug(slug: string): string {
  if (!slug) return "";
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

function domainFromEmail(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).toLowerCase().trim();
  return domain || null;
}

function slugFromDomain(domain: string): string | null {
  if (PERSONAL_EMAIL_DOMAINS.has(domain)) return null;
  const parts = domain.split(".").filter(Boolean);
  if (parts.length < 2) return null;

  if (parts.length >= 3 && parts[parts.length - 1] === "au") {
    const secondLast = parts[parts.length - 2];
    if (secondLast === "com" || secondLast === "net" || secondLast === "org") {
      const slug = parts[parts.length - 3];
      return slug && slug !== "www" && slug !== "mail" ? slug : parts[0];
    }
  }

  if (parts[parts.length - 1] === "com" || parts[parts.length - 1] === "net") {
    const slug = parts[parts.length - 2];
    return slug && slug !== "www" && slug !== "mail" ? slug : parts[0];
  }

  return parts[0] !== "www" ? parts[0] : null;
}

function websiteForSlug(slug: string, domain?: string): string {
  const preferAu =
    domain?.endsWith(".com.au") ||
    domain?.endsWith(".net.au") ||
    domain?.endsWith(".org.au") ||
    !domain;
  return preferAu ? `https://www.${slug}.com.au` : `https://www.${slug}.com`;
}

export function resolveCompany(reservation: {
  company?: string;
  email?: string;
}): ResolvedCompany | null {
  const companyField = reservation.company?.trim();
  if (companyField) {
    const slug = slugifyName(companyField);
    if (!slug) return null;
    const isPerson = looksLikePersonName(companyField);
    return {
      displayName: companyField,
      slug,
      websiteUrl: isPerson ? null : websiteForSlug(slug),
      kind: isPerson ? "person" : "company",
      source: "company",
    };
  }

  const email = reservation.email?.trim();
  if (!email) return null;
  const domain = domainFromEmail(email);
  if (!domain) return null;
  const slug = slugFromDomain(domain);
  if (!slug) return null;

  return {
    displayName: titleCaseSlug(slug),
    slug,
    websiteUrl: websiteForSlug(slug, domain),
    kind: "company",
    source: "email",
  };
}

export function candidateWebsiteUrls(slug: string): string[] {
  const safe = slug.toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!safe) return [];
  return [
    `https://www.${safe}.com.au`,
    `https://${safe}.com.au`,
    `https://www.${safe}.com/au`,
    `https://${safe}.com/au`,
    `https://www.${safe}.com`,
    `https://${safe}.com`,
  ];
}
