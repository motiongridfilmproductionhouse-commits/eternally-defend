/**
 * On-domain copyright/DMCA contact discovery — PURE logic.
 *
 * Purpose: while normal protection/discovery scans run, look at an independent
 * infringing host's OWN published legal/contact/copyright pages and propose a
 * removal-route candidate.
 *
 * Hard rules encoded here (fail-closed):
 *  - The recipient must appear LITERALLY on a page served by the infringing
 *    host itself. Nothing is ever synthesised, guessed or patterned.
 *  - WHOIS, registrar, CDN and unrelated hosting-provider mailboxes are refused.
 *  - The produced candidate is ALWAYS `DISCOVERED_UNVERIFIED`. This module can
 *    never mark a route VERIFIED; only an operator can, through
 *    /admin/removal-routes with an authoritative source + evidence snapshot.
 */

import { isSameOrganisationRecipient } from "./removal-route-policy";

/** Method stamped on automatically discovered candidates. Non-authoritative. */
export const DISCOVERY_VERIFICATION_METHOD = "AUTOMATED_ON_DOMAIN_DISCOVERY";

/** Paths commonly used by independent sites for their legal/DMCA notices. */
export const LEGAL_PAGE_PATHS = [
  "/dmca",
  "/dmca.html",
  "/dmca-policy",
  "/copyright",
  "/copyright-policy",
  "/legal",
  "/legal/dmca",
  "/terms",
  "/terms-of-service",
  "/contact",
  "/contact-us",
  "/about",
  "/privacy",
  "/report",
  "/takedown",
] as const;

/** Anchor text / href keywords that indicate a legal or contact page. */
const LEGAL_LINK_KEYWORDS = [
  "dmca",
  "copyright",
  "legal",
  "takedown",
  "contact",
  "abuse",
  "report",
  "terms",
  "privacy",
];

/**
 * Mail hosts that can never authorize an automated recipient even when they are
 * printed on the infringing page: CDNs, registrars, hosting providers, generic
 * consumer mailboxes and abuse databases.
 */
export const THIRD_PARTY_MAIL_HOSTS = [
  "cloudflare.com",
  "namecheap.com",
  "godaddy.com",
  "secureserver.net",
  "tucows.com",
  "enom.com",
  "publicdomainregistry.com",
  "hostinger.com",
  "hostgator.com",
  "bluehost.com",
  "siteground.com",
  "digitalocean.com",
  "ovh.net",
  "ovh.com",
  "hetzner.com",
  "contabo.com",
  "linode.com",
  "amazonaws.com",
  "google.com",
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "protonmail.com",
  "proton.me",
  "yandex.ru",
  "mail.ru",
  "icloud.com",
  "whoisguard.com",
  "withheldforprivacy.com",
  "privacyprotect.org",
  "abuse.ch",
  "spamcop.net",
  "lumendatabase.org",
] as const;

/** Local parts that indicate a copyright/legal channel, most specific first. */
const PREFERRED_LOCAL_PARTS = [
  "dmca",
  "copyright",
  "takedown",
  "legal",
  "abuse",
  "removal",
  "compliance",
  "support",
  "contact",
  "info",
  "admin",
];

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

export function normalizeDomain(value: string): string {
  return (value ?? "").trim().toLowerCase().replace(/^www\./, "");
}

export function hostOfUrl(url: string): string | null {
  try {
    return normalizeDomain(new URL(url).hostname);
  } catch {
    return null;
  }
}

/** Extracts unique, lower-cased email addresses literally present in text/HTML. */
export function extractEmails(text: string): string[] {
  if (!text) return [];
  const decoded = text
    .replace(/&#64;|&commat;/gi, "@")
    .replace(/\s*\[at\]\s*|\s*\(at\)\s*/gi, "@")
    .replace(/&#46;/gi, ".");
  const found = decoded.match(EMAIL_RE) ?? [];
  const out: string[] = [];
  for (const raw of found) {
    const e = raw.trim().toLowerCase().replace(/[.,;:)]+$/, "");
    // Skip asset filenames that look like addresses and obvious placeholders.
    if (/\.(png|jpe?g|gif|webp|svg|css|js|woff2?)$/i.test(e)) continue;
    if (/^(example|test|user|name|email|you|someone)@/.test(e)) continue;
    if (e.includes("example.com") || e.includes("domain.com")) continue;
    if (!out.includes(e)) out.push(e);
  }
  return out;
}

/** True when the mailbox host belongs to a CDN/registrar/host/consumer provider. */
export function isThirdPartyMailHost(email: string): boolean {
  const host = normalizeDomain((email ?? "").split("@")[1] ?? "");
  if (!host) return true;
  return THIRD_PARTY_MAIL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** Legal/contact link candidates found in a homepage's HTML. */
export function extractLegalLinks(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  const base = hostOfUrl(baseUrl);
  if (!base) return out;
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,160}?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html))) {
    const href = m[1] ?? "";
    const label = (m[2] ?? "").replace(/<[^>]+>/g, " ").toLowerCase();
    const haystack = `${href.toLowerCase()} ${label}`;
    if (!LEGAL_LINK_KEYWORDS.some((k) => haystack.includes(k))) continue;
    let abs: string;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    if (hostOfUrl(abs) !== base && !(hostOfUrl(abs) ?? "").endsWith(`.${base}`)) continue;
    if (!/^https?:/i.test(abs)) continue;
    if (!out.includes(abs)) out.push(abs);
    if (out.length >= 12) break;
  }
  return out;
}

export interface ContactCandidate {
  email: string;
  /** URL of the on-domain page the address was read from. */
  sourceUrl: string;
  /** 0-1 heuristic priority — never used to authorize a send. */
  priority: number;
  localPart: string;
}

/** Ranks addresses found on a page; copyright-specific mailboxes come first. */
export function rankContactCandidates(
  emails: string[],
  sourceUrl: string,
  domain: string,
): ContactCandidate[] {
  const d = normalizeDomain(domain);
  const pathHint = (() => {
    try {
      return new URL(sourceUrl).pathname.toLowerCase();
    } catch {
      return "";
    }
  })();
  const pageBonus = /dmca|copyright|takedown|legal/.test(pathHint) ? 0.15 : 0;

  return emails
    .filter((e) => isSameOrganisationRecipient(e, d) && !isThirdPartyMailHost(e))
    .map((email) => {
      const localPart = email.split("@")[0] ?? "";
      const idx = PREFERRED_LOCAL_PARTS.findIndex((p) => localPart === p || localPart.startsWith(p));
      const base = idx === -1 ? 0.2 : 1 - idx * 0.07;
      return { email, sourceUrl, localPart, priority: Math.min(1, base + pageBonus) };
    })
    .sort((a, b) => b.priority - a.priority);
}

export interface DiscoveredContactEvaluation {
  eligible: boolean;
  reasons: string[];
}

/**
 * Final check before a candidate row is written. Every condition must hold.
 * A failure means no candidate is created at all — never a weaker one.
 */
export function evaluateDiscoveredContact(input: {
  domain: string;
  email: string;
  sourceUrl: string;
  /** Raw text/HTML of the source page, used to prove the address was published. */
  pageContent: string;
}): DiscoveredContactEvaluation {
  const reasons: string[] = [];
  const domain = normalizeDomain(input.domain);
  const email = (input.email ?? "").trim().toLowerCase();
  const sourceHost = hostOfUrl(input.sourceUrl);

  if (!email.includes("@")) reasons.push("No parsable recipient address.");
  if (!domain) reasons.push("No infringing domain.");
  if (!sourceHost) reasons.push("Source page URL is not a valid absolute URL.");

  if (sourceHost && domain && !isSameOrganisationRecipient(`x@${sourceHost}`, domain)) {
    reasons.push(
      `Source page ${sourceHost} is not on the infringing host's own domain (${domain}).`,
    );
  }
  if (email.includes("@") && domain && !isSameOrganisationRecipient(email, domain)) {
    reasons.push(`Recipient ${email} is not an on-domain mailbox for ${domain}.`);
  }
  if (email.includes("@") && isThirdPartyMailHost(email)) {
    reasons.push(
      `Recipient ${email} belongs to a CDN/registrar/hosting/consumer mail provider and can never be an automated recipient.`,
    );
  }
  if (!extractEmails(input.pageContent ?? "").includes(email)) {
    reasons.push(
      "Recipient was not found literally published on the source page; guessed or pattern-derived addresses are refused.",
    );
  }

  return { eligible: reasons.length === 0, reasons };
}

/** Short excerpt around the address, stored as discovery evidence. */
export function buildEvidenceExcerpt(pageContent: string, email: string, radius = 220): string {
  const text = (pageContent ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const idx = text.toLowerCase().indexOf(email.toLowerCase());
  if (idx === -1) return text.slice(0, radius * 2);
  return text.slice(Math.max(0, idx - radius), idx + email.length + radius).trim();
}

/** Stable non-cryptographic content hash for the captured page. */
export function contentHash(content: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < content.length; i++) {
    const c = content.charCodeAt(i);
    h1 = (h1 ^ c) * 16777619 >>> 0;
    h2 = (h2 + c * 31 + i) >>> 0;
  }
  return `fnv1a_${h1.toString(16)}${h2.toString(16)}`;
}
