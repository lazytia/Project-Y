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
  websiteUrl: string;
  source: "company" | "email";
};

function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 48);
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
    return {
      displayName: companyField,
      slug,
      websiteUrl: websiteForSlug(slug),
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
    source: "email",
  };
}

export function candidateWebsiteUrls(slug: string): string[] {
  const safe = slug.toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!safe) return [];
  return [
    `https://www.${safe}.com.au`,
    `https://${safe}.com.au`,
    `https://www.${safe}.com`,
    `https://${safe}.com`,
  ];
}
