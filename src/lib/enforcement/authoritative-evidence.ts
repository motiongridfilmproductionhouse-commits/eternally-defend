/**
 * Authoritative on-domain evidence classification — PURE logic.
 *
 * Purpose: decide whether a discovered mailbox is genuinely PUBLISHED BY THE
 * TARGET ORGANISATION on one of its OWN authoritative pages (DMCA / copyright /
 * legal / terms / contact), and produce the provenance an operator needs in
 * /admin/removal-routes.
 *
 * This module NEVER promotes a route. It only upgrades the QUALITY of the
 * evidence attached to a `DISCOVERED_UNVERIFIED` candidate. Promotion to
 * VERIFIED remains an operator action through `verifyRemovalRoute`, which is
 * gated by `evaluateVerification` (untouched).
 */

import {
  evaluateDiscoveredContact,
  extractEmails,
  hostOfUrl,
  normalizeDomain,
} from "./contact-discovery";

export type AuthoritativePageKind = "DMCA" | "COPYRIGHT" | "LEGAL" | "TERMS" | "CONTACT";

/** Candidate verification methods an operator may pick after review. */
export type VerificationMethodCandidate = "PUBLISHED_DMCA_PAGE" | "PUBLISHED_LEGAL_CONTACT";

/** Mailboxes that are generic and therefore need copyright/legal context. */
export const GENERIC_LOCAL_PARTS = [
  "support",
  "info",
  "contact",
  "hello",
  "help",
  "admin",
  "office",
  "mail",
  "webmaster",
  "enquiry",
  "enquiries",
  "inquiries",
  "sales",
  "team",
] as const;

/** Local parts that are themselves a copyright/legal channel. */
export const SPECIFIC_LEGAL_LOCAL_PARTS = [
  "dmca",
  "copyright",
  "takedown",
  "legal",
  "abuse",
  "removal",
  "compliance",
  "ip",
  "notice",
] as const;

const PATH_KIND: Array<{ re: RegExp; kind: AuthoritativePageKind }> = [
  { re: /dmca/i, kind: "DMCA" },
  { re: /copyright|infring|takedown|report-?abuse/i, kind: "COPYRIGHT" },
  { re: /legal|policy|policies|imprint|impressum/i, kind: "LEGAL" },
  { re: /terms|tos|conditions/i, kind: "TERMS" },
  { re: /contact|about|support/i, kind: "CONTACT" },
];

const TEXT_KIND: Array<{ re: RegExp; kind: AuthoritativePageKind }> = [
  { re: /\bdmca\b/i, kind: "DMCA" },
  {
    re: /copyright (policy|notice|infringement|complaint)|notice and takedown|takedown (policy|request)/i,
    kind: "COPYRIGHT",
  },
  { re: /legal notice|legal information|imprint|impressum/i, kind: "LEGAL" },
  { re: /terms of (service|use)|terms (and|&) conditions/i, kind: "TERMS" },
  { re: /contact us|get in touch|contact information/i, kind: "CONTACT" },
];

/** Copyright/legal context words required near a generic mailbox. */
const COPYRIGHT_CONTEXT =
  /dmca|copyright|infring|takedown|intellectual property|legal (notice|department|team)|abuse/i;

/**
 * Removes markup that is not visible page content: scripts (including JSON-LD),
 * styles, templates, comments and head metadata. Addresses only present inside
 * these are NOT considered published by the organisation.
 */
export function extractVisibleText(html: string): string {
  return (
    (html ?? "")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<template\b[\s\S]*?<\/template>/gi, " ")
      .replace(/<head\b[\s\S]*?<\/head>/gi, " ")
      // Keep mailto targets: they are author-published contact affordances.
      .replace(/<a\b[^>]*href=["']mailto:([^"'?]+)[^>]*>/gi, " $1 ")
      // Block-level boundaries become line breaks so a mailbox can be attributed
      // to the specific sentence/line that publishes it.
      .replace(
        /<\/?(p|div|br|li|tr|td|th|h[1-6]|section|article|header|footer|ul|ol|table)\b[^>]*>/gi,
        "\n",
      )
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&#64;|&commat;/gi, "@")
      .replace(/&#46;/gi, ".")
      .replace(/&amp;/gi, "&")
      .replace(/[ \t\r\f\v]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .replace(/\n{2,}/g, "\n")
      .trim()
  );
}

export interface PageAuthorityClassification {
  kind: AuthoritativePageKind | null;
  /** True when the page is one of the organisation's own authoritative pages. */
  authoritative: boolean;
  signals: string[];
}

/**
 * Classifies a fetched page. Both the URL path and the visible content are
 * considered; a homepage with no legal signals is never authoritative.
 */
export function classifyAuthoritativePage(input: {
  sourceUrl: string;
  html: string;
}): PageAuthorityClassification {
  const signals: string[] = [];
  let path = "";
  try {
    path = new URL(input.sourceUrl).pathname;
  } catch {
    return { kind: null, authoritative: false, signals: ["Source URL is not absolute."] };
  }

  const text = extractVisibleText(input.html);
  let kind: AuthoritativePageKind | null = null;

  const pathHit = path === "/" ? undefined : PATH_KIND.find((p) => p.re.test(path));
  if (pathHit) {
    kind = pathHit.kind;
    signals.push(`URL path "${path}" matches an authoritative ${pathHit.kind} page.`);
  }

  const textHit = TEXT_KIND.find((t) => t.re.test(text));
  if (textHit) {
    signals.push(`Page content declares a ${textHit.kind} notice.`);
    // The URL path is the site's own declaration of the page's purpose and
    // takes precedence; page content only classifies otherwise-unlabelled URLs.
    if (!kind) kind = textHit.kind;
  }

  const authoritative = Boolean(kind) && (Boolean(pathHit) || Boolean(textHit));
  if (!authoritative) signals.push("No DMCA/copyright/legal/terms/contact signal on this page.");
  return { kind, authoritative, signals };
}

/**
 * The line/sentence that actually publishes the address. Used so a generic
 * mailbox printed elsewhere on a DMCA page is not treated as the copyright
 * channel just because the page mentions copyright.
 */
export function publishingStatement(visibleText: string, email: string): string {
  const idx = visibleText.toLowerCase().indexOf(email.toLowerCase());
  if (idx === -1) return "";
  const start = Math.max(visibleText.lastIndexOf("\n", idx), visibleText.lastIndexOf(". ", idx));
  const nl = visibleText.indexOf("\n", idx);
  const dot = visibleText.indexOf(". ", idx);
  const ends = [nl, dot].filter((n) => n !== -1);
  const end = ends.length ? Math.min(...ends) : visibleText.length;
  return visibleText.slice(start === -1 ? 0 : start + 1, end).trim();
}

/** True when the mailbox is itself a copyright/legal channel (dmca@, legal@…). */
export function isSpecificLegalLocalPart(email: string): boolean {
  const local = (email.split("@")[0] ?? "").toLowerCase();
  return SPECIFIC_LEGAL_LOCAL_PARTS.some((p) => local === p || local.startsWith(p));
}

/**
 * Any mailbox that is not itself a copyright/legal channel is treated as
 * generic — including customer-facing variants such as customersupport@,
 * consumerinfo@, feedback@ or hr@. Such addresses require an explicit
 * copyright/legal publishing statement before they can be proposed.
 */
export function isGenericLocalPart(email: string): boolean {
  return !isSpecificLegalLocalPart(email);
}

/** Visible-text excerpt centred on the address, used as stored evidence. */
export function buildVisibleExcerpt(html: string, email: string, radius = 240): string {
  const text = extractVisibleText(html);
  const idx = text.toLowerCase().indexOf(email.toLowerCase());
  if (idx === -1) return "";
  return text.slice(Math.max(0, idx - radius), idx + email.length + radius).trim();
}

export interface AuthoritativeEvidenceEvaluation {
  supported: boolean;
  pageKind: AuthoritativePageKind | null;
  methodCandidate: VerificationMethodCandidate | null;
  /** Discovery confidence. Always < 1 and never enough to auto-send. */
  confidence: number;
  excerpt: string;
  reasons: string[];
  signals: string[];
}

const KIND_METHOD: Record<AuthoritativePageKind, VerificationMethodCandidate> = {
  DMCA: "PUBLISHED_DMCA_PAGE",
  COPYRIGHT: "PUBLISHED_DMCA_PAGE",
  LEGAL: "PUBLISHED_LEGAL_CONTACT",
  TERMS: "PUBLISHED_LEGAL_CONTACT",
  CONTACT: "PUBLISHED_LEGAL_CONTACT",
};

const KIND_CONFIDENCE: Record<AuthoritativePageKind, number> = {
  DMCA: 0.5,
  COPYRIGHT: 0.5,
  LEGAL: 0.42,
  TERMS: 0.36,
  CONTACT: 0.34,
};

/**
 * Decides whether a discovered mailbox is supported by the target's own
 * authoritative page. Fail-closed: any missing condition means unsupported and
 * no candidate is proposed at all.
 */
export function evaluateAuthoritativeEvidence(input: {
  domain: string;
  email: string;
  sourceUrl: string;
  html: string;
}): AuthoritativeEvidenceEvaluation {
  const reasons: string[] = [];
  const domain = normalizeDomain(input.domain);
  const email = (input.email ?? "").trim().toLowerCase();

  // 1. All existing discovery policy still applies (on-domain source, on-domain
  //    mailbox, no CDN/registrar/consumer host, literally published).
  const base = evaluateDiscoveredContact({
    domain,
    email,
    sourceUrl: input.sourceUrl,
    pageContent: input.html,
  });
  if (!base.eligible) reasons.push(...base.reasons);

  // 2. The page itself must be one of the organisation's authoritative pages.
  const page = classifyAuthoritativePage({ sourceUrl: input.sourceUrl, html: input.html });
  if (!page.authoritative || !page.kind) {
    reasons.push(
      "Source page is not one of the organisation's own authoritative pages (/dmca, /copyright, /legal, /terms, /contact or equivalent).",
    );
  }

  // 3. The address must appear in VISIBLE page content, not only in scripts,
  //    JSON-LD blobs or head metadata.
  const visible = extractVisibleText(input.html);
  if (!extractEmails(visible).includes(email)) {
    reasons.push(
      "Address is not published in the page's visible content (script/JSON-LD/metadata occurrences are not organisational publication).",
    );
  }

  const excerpt = buildVisibleExcerpt(input.html, email);

  // 4. Any mailbox that is not itself a copyright/legal channel (support@,
  //    info@, customersupport@, feedback@, hr@ …) is never authoritative merely
  //    because it appears on a legal-ish page: the publishing statement must
  //    present it as the copyright/legal channel.
  if (isGenericLocalPart(email)) {
    const specificPage = page.kind === "DMCA" || page.kind === "COPYRIGHT" || page.kind === "LEGAL";
    const contextual = COPYRIGHT_CONTEXT.test(publishingStatement(visible, email));
    if (!specificPage || !contextual) {
      reasons.push(
        `Generic mailbox ${email} is not presented as the copyright/legal contact on this page; it cannot be proposed as a removal recipient.`,
      );
    }
    }
  }

  // 5. Source must be the target's own host (defensive; also covered above).
  const srcHost = hostOfUrl(input.sourceUrl);
  if (srcHost && domain && srcHost !== domain && !srcHost.endsWith(`.${domain}`)) {
    reasons.push(`Evidence page ${srcHost} is not served by ${domain}.`);
  }

  const supported = reasons.length === 0;
  return {
    supported,
    pageKind: page.kind,
    methodCandidate: supported && page.kind ? KIND_METHOD[page.kind] : null,
    confidence: supported && page.kind ? KIND_CONFIDENCE[page.kind] : 0,
    excerpt,
    reasons,
    signals: page.signals,
  };
}
