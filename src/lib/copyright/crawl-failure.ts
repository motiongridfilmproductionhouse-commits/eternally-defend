/**
 * Exact-page crawl failure categories for Copyright Intelligence.
 * Network/render failures are never treated as content rejection.
 */

export const CRAWL_FAILURE_CATEGORIES = [
  "dns_failure",
  "private_or_reserved_address",
  "redirect_rejected",
  "redirect_loop",
  "connect_failure",
  "tls_failure",
  "timeout",
  "navigation_timeout",
  "blocked_403",
  "blocked_robots",
  "access_denied",
  "response_too_large",
  "unsupported_mime",
  "unsupported_content_type",
  "empty_static_html",
  "javascript_required",
  "cloudflare_challenge",
  "render_failure",
  "browser_render_empty",
  "provider_failure",
  "aborted_by_deadline",
] as const;

export type CrawlFailureCategory = (typeof CRAWL_FAILURE_CATEGORIES)[number];

export function isCrawlFailureCategory(value: unknown): value is CrawlFailureCategory {
  return (
    typeof value === "string" &&
    (CRAWL_FAILURE_CATEGORIES as readonly string[]).includes(value)
  );
}

/** Map deepfake SafeFetchFailureCategory / error text → copyright crawl categories. */
export function mapSafeFetchToCrawlFailure(
  category: string | undefined,
  error?: unknown,
): CrawlFailureCategory {
  const msg =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : typeof error === "string"
        ? error
        : "";
  const lower = `${category ?? ""} ${msg}`.toLowerCase();

  if (/aborted_by_deadline|deadline/.test(lower) && /abort/.test(lower)) {
    return "aborted_by_deadline";
  }
  if (/dns|enotfound|eai_again|getaddrinfo/.test(lower)) return "dns_failure";
  if (/private|reserved/.test(lower)) return "private_or_reserved_address";
  if (/redirect/.test(lower)) return "redirect_rejected";
  if (/cert|ssl|tls|sni|handshake|err_tls|altname/.test(lower)) return "tls_failure";
  if (/timeout|etimedout|timed out/.test(lower)) return "timeout";
  if (/403|forbidden|access denied/.test(lower)) return "access_denied";
  if (/cloudflare|checking your browser|cf-browser/.test(lower)) return "cloudflare_challenge";
  if (/javascript required|enable javascript/.test(lower)) return "javascript_required";
  if (/redirect loop/.test(lower)) return "redirect_loop";
  if (/navigation timeout|navigating timeout/.test(lower)) return "navigation_timeout";
  if (/browser render empty|crawl4ai returned empty/.test(lower)) return "browser_render_empty";
  if (/robots/.test(lower)) return "blocked_robots";
  if (/too.?large|max.?safe|payload/.test(lower)) return "response_too_large";
  if (/mime|content-type|unsupported/.test(lower)) return "unsupported_mime";
  if (/firecrawl|provider|scrape/.test(lower)) return "provider_failure";
  if (/econnrefused|econnreset|enetunreach|ehostunreach|connect/.test(lower)) {
    return "connect_failure";
  }
  if (/abort/.test(lower)) return "aborted_by_deadline";
  return "connect_failure";
}

export function emptyCrawlFailureCounts(): Record<CrawlFailureCategory, number> {
  return Object.fromEntries(
    CRAWL_FAILURE_CATEGORIES.map((c) => [c, 0]),
  ) as Record<CrawlFailureCategory, number>;
}

export function bumpCrawlFailure(
  counts: Record<string, number>,
  category: CrawlFailureCategory | null | undefined,
): void {
  if (!category) return;
  counts[category] = (counts[category] ?? 0) + 1;
}
