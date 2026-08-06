/**
 * Shared evidence URL resolution for Deepfake Intelligence.
 *
 * Client-visible "Open verified evidence page" links must only use
 * server-validated http(s) final_url / canonical_url values.
 */

export interface EvidenceUrlFields {
  final_url?: string | null;
  canonical_url?: string | null;
  url?: string | null;
  url_verification_status?: string | null;
  verified_domain?: string | null;
  source_host?: string | null;
}

/** True only for non-empty http:// or https:// absolute URLs. */
export function isAllowedHttpUrl(value: string | null | undefined): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** Returns a trimmed http(s) URL, or null when empty/undefined/rejected protocol. */
export function sanitizeEvidenceUrl(value: string | null | undefined): string | null {
  if (!isAllowedHttpUrl(value)) return null;
  return value.trim();
}

/**
 * Prefer final_url, then canonical_url.
 * Never returns empty, undefined, rejected-status, or non-http(s) URLs.
 */
export function resolveVerifiedEvidenceHref(fields: EvidenceUrlFields): string | null {
  if (fields.url_verification_status === "URL_REJECTED") {
    return null;
  }

  return sanitizeEvidenceUrl(fields.final_url) ?? sanitizeEvidenceUrl(fields.canonical_url) ?? null;
}

export function resolveVerifiedEvidenceDomain(
  fields: EvidenceUrlFields,
  href?: string | null,
): string | null {
  const verified = fields.verified_domain?.trim();
  if (verified) return verified;

  const host = fields.source_host?.trim();
  if (host) return host;

  const link = href ?? resolveVerifiedEvidenceHref(fields);
  if (!link) return null;

  try {
    return new URL(link).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export type VerifiedEvidenceLink =
  | {
      kind: "link";
      href: string;
      domain: string;
      label: "Open verified evidence page";
      target: "_blank";
      rel: "noopener noreferrer";
      clickable: true;
    }
  | {
      kind: "unavailable";
      message: "Evidence URL unavailable.";
      clickable: false;
      href: null;
      domain: string | null;
    };

/**
 * UI mapping for the verified evidence anchor.
 * Use only when rendering "Open verified evidence page".
 */
export function buildVerifiedEvidenceLink(fields: EvidenceUrlFields): VerifiedEvidenceLink {
  const href = resolveVerifiedEvidenceHref(fields);
  const domain = resolveVerifiedEvidenceDomain(fields, href);

  if (!href) {
    return {
      kind: "unavailable",
      message: "Evidence URL unavailable.",
      clickable: false,
      href: null,
      domain,
    };
  }

  return {
    kind: "link",
    href,
    domain: domain ?? "",
    label: "Open verified evidence page",
    target: "_blank",
    rel: "noopener noreferrer",
    clickable: true,
  };
}

/** Sanitize final/canonical URLs on API responses for URL_VERIFIED rows. */
export function projectClientEvidenceUrls<T extends EvidenceUrlFields>(
  finding: T,
): T & {
  final_url: string | null;
  canonical_url: string | null;
  url: string;
} {
  const finalUrl = sanitizeEvidenceUrl(finding.final_url);
  const canonicalUrl = sanitizeEvidenceUrl(finding.canonical_url);
  const evidenceHref = finalUrl ?? canonicalUrl;

  return {
    ...finding,
    final_url: finalUrl,
    canonical_url: canonicalUrl,
    url: evidenceHref ?? sanitizeEvidenceUrl(finding.url) ?? finding.url ?? "",
  };
}
