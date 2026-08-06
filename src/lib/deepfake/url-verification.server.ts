/**
 * URL verification for Deepfake Intelligence leads.
 *
 * Every lead must resolve to a reachable, identity-matched content page
 * before it can appear in client results. Search snippets are never used
 * as page evidence.
 */

import { matchesSelectedIdentity } from "./identity.server";
import { createHash } from "node:crypto";
import {
  detectPageType,
  isExcludedListingPageType,
  type PageEvidenceTarget,
} from "./page-evidence.server";
import { isAllowedHttpUrl } from "./evidence-url";
import {
  abortableSleep,
  assertNotAborted,
  boundTimeoutMs,
  isAbortError,
  isDeadlineOrTimeoutError,
  mergeAbortSignals,
} from "./scan-runtime.server";
import {
  assertSafePublicUrlForFetch,
  classifySafeFetchFailure,
  fetchValidatedPublicHttpUrl,
  isSafePublicHttpUrl,
  releaseProbeResponseBody,
  type SafeFetchFailureCategory,
} from "./url-safety.server";

export type UrlVerificationStatus = "URL_VERIFIED" | "URL_REJECTED";

export interface UrlVerificationTarget {
  name: string;
  aliases?: string[];
  handles?: string[];
}

export interface UrlVerificationInput {
  discovered_url: string;
  final_url?: string | null;
  http_status?: number | null;
  redirect_chain?: string[];
  /** Real title from the crawled final page — never a search snippet. */
  crawled_title?: string | null;
  /** Real description from the crawled final page. */
  crawled_description?: string | null;
  /** Primary body text from the crawled final page. */
  crawled_page_text?: string | null;
  page_inspected?: boolean | null;
  /** Original search title — used only to detect snippet mismatch, never as evidence. */
  search_title?: string | null;
  search_snippet?: string | null;
  target: UrlVerificationTarget;
  crawled_at?: string | null;
}

export interface UrlVerificationResult {
  discovered_url: string;
  final_url: string;
  canonical_url: string;
  http_status: number | null;
  redirect_chain: string[];
  crawled_at: string;
  page_title: string | null;
  page_description: string | null;
  page_text: string;
  page_inspected: boolean;
  verified_domain: string | null;
  url_verification_status: UrlVerificationStatus;
  rejection_reason: string | null;
}

export interface UrlVerificationMetrics {
  submitted: number;
  crawl_succeeded: number;
  crawl_failed: number;
  identity_rejected: number;
  page_type_rejected: number;
  url_rejected: number;
  dns_resolution_failed: number;
  private_address_rejected: number;
  tls_connection_failed: number;
  request_timeout: number;
  redirect_rejected: number;
  crawl_provider_failed: number;
  network_failed: number;
}

const MIN_PRIMARY_CONTENT_CHARS = 80;

export function normalizeCanonicalUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");

    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(?:utm_|fbclid$|gclid$|ref$|source$|si$|feature$)/i.test(key)) {
        parsed.searchParams.delete(key);
      }
    }

    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

export function contentFingerprint(input: {
  title?: string | null;
  page_text?: string | null;
}): string | null {
  const normalized = [input.title ?? "", input.page_text ?? ""]
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length < MIN_PRIMARY_CONTENT_CHARS) {
    return null;
  }

  return createHash("sha256").update(normalized.slice(0, 8_000)).digest("hex");
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function isHomepageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return path === "/" && ![...parsed.searchParams.keys()].length;
  } catch {
    return false;
  }
}

export function isRedirectOnlyResult(input: {
  discovered_url: string;
  final_url: string;
  http_status?: number | null;
  page_text?: string | null;
  page_title?: string | null;
}): boolean {
  const discovered = normalizeCanonicalUrl(input.discovered_url);
  const finalUrl = normalizeCanonicalUrl(input.final_url);

  if (discovered === finalUrl) return false;

  /*
   * Redirect landed on a homepage or empty shell — treat as redirect-only.
   */
  if (isHomepageUrl(finalUrl)) return true;

  const body = (input.page_text ?? "").trim();
  const title = (input.page_title ?? "").trim();
  if (!title && body.length < MIN_PRIMARY_CONTENT_CHARS) return true;

  return false;
}

export function containsTargetName(text: string, target: UrlVerificationTarget): boolean {
  return matchesSelectedIdentity(text, target);
}

/**
 * Strip common page chrome so identity matches in nav/comments/recommendations
 * do not count as primary-content evidence.
 */
export function extractPrimaryContent(pageText: string): string {
  const lines = pageText
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const chromePattern =
    /^(?:home|about|contact|login|sign\s*in|sign\s*up|register|menu|search|categories|tags|related|recommended|you\s+may\s+also|more\s+from|trending|popular|comments?|reply|share|follow|subscribe|cookie|privacy|terms|advertisement|sponsored)\b/i;

  const sectionHeader =
    /^(?:related(?:\s+videos?|\s+posts?|\s+articles?)?|recommended(?:\s+for\s+you)?|you\s+may\s+also\s+like|more\s+like\s+this|trending\s+now|popular\s+videos?|comments?(?:\s*\(\d+\))?|recent\s+comments?|navigation|main\s+menu|footer|sidebar)\s*:?\s*$/i;

  const kept: string[] = [];
  let skippingSection = false;

  for (const line of lines) {
    if (sectionHeader.test(line)) {
      skippingSection = true;
      continue;
    }

    if (skippingSection) {
      /*
       * Leave chrome sections once a substantial new heading-like line appears.
       */
      if (line.length > 80 && !chromePattern.test(line)) {
        skippingSection = false;
      } else {
        continue;
      }
    }

    if (chromePattern.test(line) && line.length < 60) {
      continue;
    }

    kept.push(line);
  }

  /*
   * Also drop inline recommendation / comment markers inside long blobs.
   */
  const joined = kept.join("\n");
  return joined
    .replace(
      /(?:related videos?|recommended for you|you may also like|more like this|trending now|comments?)\s*:[\s\S]{0,1200}/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

export function identityInPrimaryContent(input: {
  title?: string | null;
  description?: string | null;
  page_text?: string | null;
  target: UrlVerificationTarget;
}): {
  inTitle: boolean;
  inDescription: boolean;
  inPrimaryBody: boolean;
  onlyInChrome: boolean;
} {
  const title = input.title ?? "";
  const description = input.description ?? "";
  const fullText = input.page_text ?? "";
  const primary = extractPrimaryContent(fullText);

  const inTitle = containsTargetName(title, input.target);
  const inDescription = containsTargetName(description, input.target);
  const inPrimaryBody = containsTargetName(primary, input.target);
  const inFullText = containsTargetName(fullText, input.target);

  return {
    inTitle,
    inDescription,
    inPrimaryBody,
    onlyInChrome: inFullText && !inTitle && !inDescription && !inPrimaryBody,
  };
}

/**
 * Pure verification decision from already-resolved + crawled page data.
 * Network I/O lives in resolveRedirectChain / verifyCandidateUrls.
 */
export function evaluateUrlVerification(input: UrlVerificationInput): UrlVerificationResult {
  const discovered = input.discovered_url.trim();
  const finalUrl = (input.final_url ?? discovered).trim();
  const canonical = normalizeCanonicalUrl(finalUrl);
  const crawledAt = input.crawled_at ?? new Date().toISOString();
  const redirectChain = input.redirect_chain?.length ? input.redirect_chain : [discovered];

  const base = {
    discovered_url: discovered,
    final_url: finalUrl,
    canonical_url: canonical,
    http_status: input.http_status ?? null,
    redirect_chain: redirectChain,
    crawled_at: crawledAt,
    page_title: input.crawled_title?.trim() || null,
    page_description: input.crawled_description?.trim() || null,
    page_text: input.crawled_page_text ?? "",
    page_inspected: Boolean(input.page_inspected),
    verified_domain: hostOf(finalUrl),
  };

  const reject = (reason: string): UrlVerificationResult => ({
    ...base,
    url_verification_status: "URL_REJECTED",
    rejection_reason: reason,
  });

  if (!isAllowedHttpUrl(discovered) || !isAllowedHttpUrl(finalUrl)) {
    return reject("Only http:// or https:// evidence URLs are allowed.");
  }

  const status = input.http_status ?? 0;
  if (!status || status < 200 || status >= 400) {
    return reject(`Broken or unreachable URL (HTTP ${status || "unknown"}).`);
  }

  if (isHomepageUrl(finalUrl)) {
    return reject("Homepage URLs are not exact evidence pages.");
  }

  const pageType = detectPageType(finalUrl, input.crawled_title, input.crawled_page_text);

  if (isExcludedListingPageType(pageType)) {
    return reject(
      `Rejected ${pageType.replace(/_/g, " ")} page. Search, tag, category, performer-index and generic listings are not evidence URLs.`,
    );
  }

  if (
    isRedirectOnlyResult({
      discovered_url: discovered,
      final_url: finalUrl,
      http_status: status,
      page_text: input.crawled_page_text,
      page_title: input.crawled_title,
    })
  ) {
    return reject(
      "Redirect-only URL: final destination is a homepage or empty shell, not an exact content page.",
    );
  }

  if (!input.page_inspected) {
    return reject(
      "Exact final URL could not be crawled; search snippets are never used as page evidence.",
    );
  }

  const primary = extractPrimaryContent(input.crawled_page_text ?? "");
  if (primary.length < MIN_PRIMARY_CONTENT_CHARS) {
    return reject(
      "Final page has insufficient primary content after removing navigation, comments and recommendations.",
    );
  }

  const identity = identityInPrimaryContent({
    title: input.crawled_title,
    description: input.crawled_description,
    page_text: input.crawled_page_text,
    target: input.target,
  });

  if (identity.onlyInChrome) {
    return reject(
      "Protected identity appears only in recommendations, comments, navigation or unrelated neighboring entries.",
    );
  }

  if (!identity.inTitle && !identity.inPrimaryBody) {
    /*
     * Search snippet may have mentioned the person, but the crawled page
     * does not. Trust the crawled page and reject.
     */
    const snippetMentioned =
      containsTargetName(input.search_title ?? "", input.target) ||
      containsTargetName(input.search_snippet ?? "", input.target);

    if (snippetMentioned) {
      return reject(
        "Crawled page content differs from the search snippet: protected identity is not evidenced in the final page title or primary content.",
      );
    }

    return reject("Final page title and primary content do not match the selected identity.");
  }

  return {
    ...base,
    page_text: primary,
    url_verification_status: "URL_VERIFIED",
    rejection_reason: null,
  };
}

export function isUrlVerified(status: UrlVerificationStatus | string | null | undefined): boolean {
  return status === "URL_VERIFIED";
}

/**
 * Cancel a completed probe body under the hop AbortSignal. Scan abort still
 * propagates; hop-timeout during cleanup must not convert a finished 2xx/3xx
 * probe into request_timeout after headers/status were already observed.
 */
async function releaseCompletedProbeBody(
  response: Response | null | undefined,
  hopSignal: AbortSignal,
  scanSignal?: AbortSignal | null,
): Promise<void> {
  if (!response) return;
  try {
    await releaseProbeResponseBody(response, hopSignal);
  } catch (error) {
    if (scanSignal?.aborted) {
      throw error;
    }
  }
}

/**
 * Follow redirects manually and capture the chain + final URL + HTTP status.
 * SSRF: validate public URL + DNS (reject private) before each hop, then
 * DNS-rebinding-safe pinned fetch (validated address + TLS SNI hostname).
 * Redirect:"manual"; every redirect destination is re-validated before connect.
 * Probe response bodies are cancelled before retry/redirect/return.
 * Exact-page verification gates in evaluateUrlVerification are unchanged.
 */
export async function resolveRedirectChain(
  url: string,
  options?: {
    maxRedirects?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
    softDeadlineMs?: number;
  },
): Promise<{
  discovered_url: string;
  final_url: string;
  http_status: number;
  redirect_chain: string[];
  ok: boolean;
  error?: string;
  failure_category?: SafeFetchFailureCategory;
}> {
  const maxRedirects = options?.maxRedirects ?? 8;
  const timeoutMs = boundTimeoutMs(
    options?.timeoutMs ?? 12_000,
    options?.signal,
    options?.softDeadlineMs,
  );
  const chain: string[] = [url];
  let current = url;

  if (!isSafePublicHttpUrl(url)) {
    return {
      discovered_url: url,
      final_url: url,
      http_status: 0,
      redirect_chain: chain,
      ok: false,
      error: "URL failed public http(s) safety checks.",
      failure_category: "url_safety_rejected",
    };
  }

  for (let hop = 0; hop <= maxRedirects; hop++) {
    assertNotAborted(options?.signal);

    for (let attempt = 0; attempt < 3; attempt++) {
      assertNotAborted(options?.signal);
      const hopTimeout = boundTimeoutMs(timeoutMs, options?.signal, options?.softDeadlineMs);
      const signal = mergeAbortSignals(options?.signal, AbortSignal.timeout(hopTimeout));

      let response: Response | null = null;

      try {
        // DNS validation (private reject) under the hop timeout, then pinned fetch.
        try {
          await assertSafePublicUrlForFetch(current, undefined, signal);
        } catch (error) {
          // Scan-level abort must propagate; hop-level timeouts soft-fail.
          if (options?.signal?.aborted) {
            throw error;
          }
          if (isAbortError(error) && !isDeadlineOrTimeoutError(error)) {
            throw error;
          }
          return {
            discovered_url: url,
            final_url: current,
            http_status: 0,
            redirect_chain: chain,
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : "URL failed DNS/public-address safety checks.",
            failure_category: classifySafeFetchFailure(error),
          };
        }

        try {
          response = await fetchValidatedPublicHttpUrl(current, {
            method: "HEAD",
            signal,
            headers: {
              "user-agent": "EternaSentinelDeepfakeIntel/1.0",
              accept: "text/html,application/xhtml+xml,*/*",
            },
          });
        } catch (headError) {
          if (options?.signal?.aborted) {
            throw headError;
          }
          if (isAbortError(headError) && !isDeadlineOrTimeoutError(headError)) {
            throw headError;
          }
          response = await fetchValidatedPublicHttpUrl(current, {
            method: "GET",
            signal,
            headers: {
              "user-agent": "EternaSentinelDeepfakeIntel/1.0",
              accept: "text/html,application/xhtml+xml,*/*",
            },
          });
        }

        const status = response.status;

        if ([301, 302, 303, 307, 308].includes(status)) {
          const location = response.headers.get("location");
          if (!location) {
            await releaseCompletedProbeBody(response, signal, options?.signal);
            response = null;
            return {
              discovered_url: url,
              final_url: current,
              http_status: status,
              redirect_chain: chain,
              ok: false,
              error: "Redirect response missing Location header.",
              failure_category: "redirect_rejected",
            };
          }

          let next: string;
          try {
            next = new URL(location, current).toString();
          } catch {
            await releaseCompletedProbeBody(response, signal, options?.signal);
            response = null;
            return {
              discovered_url: url,
              final_url: current,
              http_status: status,
              redirect_chain: chain,
              ok: false,
              error: "Redirect Location was not a valid URL.",
              failure_category: "redirect_rejected",
            };
          }

          if (!isSafePublicHttpUrl(next)) {
            await releaseCompletedProbeBody(response, signal, options?.signal);
            response = null;
            return {
              discovered_url: url,
              final_url: current,
              http_status: status,
              redirect_chain: chain,
              ok: false,
              error: "Redirect target failed public http(s) safety checks.",
              failure_category: "redirect_rejected",
            };
          }

          try {
            await assertSafePublicUrlForFetch(next, undefined, signal);
          } catch (error) {
            await releaseCompletedProbeBody(response, signal, options?.signal);
            response = null;
            if (options?.signal?.aborted) {
              throw error;
            }
            if (isAbortError(error) && !isDeadlineOrTimeoutError(error)) {
              throw error;
            }
            return {
              discovered_url: url,
              final_url: current,
              http_status: status,
              redirect_chain: [...chain, next],
              ok: false,
              error:
                error instanceof Error
                  ? `Unsafe redirect target: ${error.message}`
                  : "Unsafe redirect target.",
              failure_category: classifySafeFetchFailure(error),
            };
          }

          if (chain.includes(next)) {
            await releaseCompletedProbeBody(response, signal, options?.signal);
            response = null;
            return {
              discovered_url: url,
              final_url: current,
              http_status: status,
              redirect_chain: chain,
              ok: false,
              error: "Redirect loop detected.",
              failure_category: "redirect_rejected",
            };
          }

          await releaseCompletedProbeBody(response, signal, options?.signal);
          response = null;
          chain.push(next);
          current = next;
          break;
        }

        if (
          (status === 429 || (status >= 500 && status < 600)) &&
          attempt < 2 &&
          !options?.signal?.aborted
        ) {
          await releaseCompletedProbeBody(response, signal, options?.signal);
          response = null;
          await abortableSleep(
            boundTimeoutMs((attempt + 1) * 1_000, options?.signal, options?.softDeadlineMs),
            options?.signal,
          );
          continue;
        }

        await releaseCompletedProbeBody(response, signal, options?.signal);
        response = null;
        return {
          discovered_url: url,
          final_url: current,
          http_status: status,
          redirect_chain: chain,
          ok: status >= 200 && status < 400,
        };
      } catch (error) {
        if (response) {
          await releaseCompletedProbeBody(response, signal, options?.signal);
          response = null;
        }

        // Parent/scan abort propagates. Per-hop AbortSignal.timeout soft-fails
        // the candidate as request_timeout so verification can continue.
        if (options?.signal?.aborted) {
          throw error;
        }
        if (isAbortError(error) && !isDeadlineOrTimeoutError(error)) {
          throw error;
        }

        if (
          attempt < 2 &&
          (isDeadlineOrTimeoutError(error) ||
            (error instanceof Error &&
              /\b(?:timeout|timed out|econnreset|etimedout)\b/i.test(error.message)))
        ) {
          await abortableSleep(
            boundTimeoutMs((attempt + 1) * 1_000, options?.signal, options?.softDeadlineMs),
            options?.signal,
          );
          continue;
        }

        return {
          discovered_url: url,
          final_url: current,
          http_status: 0,
          redirect_chain: chain,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          failure_category: classifySafeFetchFailure(error),
        };
      }
    }

    if (chain[chain.length - 1] === current) {
      continue;
    }
  }

  return {
    discovered_url: url,
    final_url: current,
    http_status: 0,
    redirect_chain: chain,
    ok: false,
    error: "Too many redirects.",
    failure_category: "redirect_rejected",
  };
}

export type VerifiableHit = {
  url: string;
  title?: string;
  description?: string;
  query: string;
  source?: string;
  image_url?: string;
  thumbnail_url?: string;
  media_url?: string;
  content_match_score?: number;
  threat_signals?: string[];
  related_links?: string[];
};

/**
 * Resolve redirects, crawl the final canonical URL, and verify each lead.
 * Search titles/snippets are retained only for mismatch detection and are
 * never treated as crawled page evidence.
 */
export async function verifyCandidateUrls(
  hits: VerifiableHit[],
  target: PageEvidenceTarget,
  options?: {
    maxPages?: number;
    signal?: AbortSignal;
    softDeadlineMs?: number;
    onBatchComplete?: (info: {
      batchIndex: number;
      verifiedSoFar: number;
      metrics: UrlVerificationMetrics;
      verifiedBatch: Array<
        VerifiableHit & {
          discovered_url: string;
          final_url: string;
          canonical_url: string;
          http_status: number | null;
          redirect_chain: string[];
          crawled_at: string;
          page_title: string | null;
          page_description: string | null;
          page_text: string;
          page_inspected: boolean;
          verified_domain: string | null;
          url_verification_status: UrlVerificationStatus;
          rejection_reason: string | null;
          evidence_page_url: string;
        }
      >;
    }) => Promise<void> | void;
  },
): Promise<{
  verified: Array<
    VerifiableHit & {
      discovered_url: string;
      final_url: string;
      canonical_url: string;
      http_status: number | null;
      redirect_chain: string[];
      crawled_at: string;
      page_title: string | null;
      page_description: string | null;
      page_text: string;
      page_inspected: boolean;
      verified_domain: string | null;
      url_verification_status: UrlVerificationStatus;
      rejection_reason: string | null;
      evidence_page_url: string;
    }
  >;
  rejected: UrlVerificationResult[];
  metrics: UrlVerificationMetrics;
}> {
  const { scrapeMediaFromPage } = await import("./media-discovery.server");
  const maxPages = options?.maxPages ?? 40;
  const verified: Array<
    VerifiableHit & {
      discovered_url: string;
      final_url: string;
      canonical_url: string;
      http_status: number | null;
      redirect_chain: string[];
      crawled_at: string;
      page_title: string | null;
      page_description: string | null;
      page_text: string;
      page_inspected: boolean;
      verified_domain: string | null;
      url_verification_status: UrlVerificationStatus;
      rejection_reason: string | null;
      evidence_page_url: string;
    }
  > = [];
  const rejected: UrlVerificationResult[] = [];
  const seenCanonical = new Set<string>();

  const limited = hits.slice(0, maxPages);
  const metrics: UrlVerificationMetrics = {
    submitted: limited.length,
    crawl_succeeded: 0,
    crawl_failed: 0,
    identity_rejected: 0,
    page_type_rejected: 0,
    url_rejected: 0,
    dns_resolution_failed: 0,
    private_address_rejected: 0,
    tls_connection_failed: 0,
    request_timeout: 0,
    redirect_rejected: 0,
    crawl_provider_failed: 0,
    network_failed: 0,
  };

  const bumpNetworkCategory = (category?: SafeFetchFailureCategory) => {
    switch (category) {
      case "dns_resolution_failed":
        metrics.dns_resolution_failed++;
        break;
      case "private_address_rejected":
        metrics.private_address_rejected++;
        break;
      case "tls_connection_failed":
        metrics.tls_connection_failed++;
        break;
      case "request_timeout":
        metrics.request_timeout++;
        break;
      case "redirect_rejected":
        metrics.redirect_rejected++;
        break;
      case "crawl_provider_failed":
        metrics.crawl_provider_failed++;
        break;
      case "url_safety_rejected":
        metrics.url_rejected++;
        break;
      default:
        metrics.network_failed++;
        break;
    }
  };
  const batchSize = 3;

  for (let start = 0; start < limited.length; start += batchSize) {
    assertNotAborted(options?.signal);
    const batch = limited.slice(start, start + batchSize);
    const batchVerified: typeof verified = [];

    const batchResults = await Promise.all(
      batch.map(async (hit) => {
        assertNotAborted(options?.signal);
        const discovered = hit.url;
        const searchTitle = hit.title ?? null;
        const searchSnippet = hit.description ?? null;

        const resolved = await resolveRedirectChain(discovered, {
          signal: options?.signal,
          softDeadlineMs: options?.softDeadlineMs,
        });

        if (!resolved.ok) {
          const failed = evaluateUrlVerification({
            discovered_url: discovered,
            final_url: resolved.final_url,
            http_status: resolved.http_status || 0,
            redirect_chain: resolved.redirect_chain,
            crawled_title: null,
            crawled_description: null,
            crawled_page_text: "",
            page_inspected: false,
            search_title: searchTitle,
            search_snippet: searchSnippet,
            target,
          });
          return {
            hit,
            verification: failed,
            media: null as null,
            // Only attribute distinct network categories when resolveRedirectChain
            // classified one. Ordinary HTTP 4xx/5xx responses stay url_rejected.
            networkFailureCategory: resolved.failure_category,
          };
        }

        const finalUrl = resolved.final_url;
        const canonical = normalizeCanonicalUrl(finalUrl);

        /*
         * Fast URL-shape rejects before spending a Firecrawl scrape.
         */
        if (isHomepageUrl(finalUrl)) {
          const failed = evaluateUrlVerification({
            discovered_url: discovered,
            final_url: finalUrl,
            http_status: resolved.http_status,
            redirect_chain: resolved.redirect_chain,
            crawled_title: null,
            crawled_description: null,
            crawled_page_text: "",
            page_inspected: false,
            search_title: searchTitle,
            search_snippet: searchSnippet,
            target,
          });
          return { hit, verification: failed, media: null };
        }

        const earlyType = detectPageType(finalUrl, null, null);
        if (isExcludedListingPageType(earlyType)) {
          const failed = evaluateUrlVerification({
            discovered_url: discovered,
            final_url: finalUrl,
            http_status: resolved.http_status,
            redirect_chain: resolved.redirect_chain,
            crawled_title: null,
            crawled_description: null,
            crawled_page_text: "",
            page_inspected: false,
            search_title: searchTitle,
            search_snippet: searchSnippet,
            target,
          });
          return { hit, verification: failed, media: null };
        }

        /*
         * Crawl the final URL. Intentionally omit search title/snippet so
         * media-discovery cannot treat them as page evidence.
         */
        const scraped = await scrapeMediaFromPage(
          {
            url: finalUrl,
            query: hit.query,
            source: hit.source,
            image_url: hit.image_url,
            thumbnail_url: hit.thumbnail_url,
            media_url: hit.media_url,
          },
          {
            signal: options?.signal,
            softDeadlineMs: options?.softDeadlineMs,
          },
        );

        const pageRecord = scraped.find((item) => item.page_inspected) ?? scraped[0] ?? null;

        const crawledAt = new Date().toISOString();
        const pageInspected = Boolean(pageRecord?.page_inspected);
        const verification = evaluateUrlVerification({
          discovered_url: discovered,
          final_url: finalUrl,
          http_status: resolved.http_status,
          redirect_chain: resolved.redirect_chain,
          crawled_title: pageRecord?.title ?? null,
          crawled_description: pageRecord?.description ?? null,
          crawled_page_text: pageRecord?.page_text ?? "",
          page_inspected: pageInspected,
          search_title: searchTitle,
          search_snippet: searchSnippet,
          target,
          crawled_at: crawledAt,
        });

        const providerScrapeFailed = scraped.some((item) => item.provider_scrape_failed);
        const crawlFailedClosed =
          providerScrapeFailed &&
          !pageInspected &&
          verification.url_verification_status !== "URL_VERIFIED";

        return {
          hit,
          verification: {
            ...verification,
            canonical_url: canonical,
          },
          media: scraped,
          // Firecrawl/API scrape failure only — not thin-content or URL gates.
          networkFailureCategory: crawlFailedClosed
            ? ("crawl_provider_failed" as const)
            : undefined,
        };
      }),
    );

    for (const item of batchResults) {
      const { hit, verification, media } = item;
      const networkFailureCategory =
        "networkFailureCategory" in item
          ? (item as { networkFailureCategory?: SafeFetchFailureCategory }).networkFailureCategory
          : undefined;

      if (verification.url_verification_status !== "URL_VERIFIED") {
        if (verification.page_inspected) {
          metrics.crawl_succeeded++;
        } else {
          metrics.crawl_failed++;
        }

        if (networkFailureCategory) {
          // Distinct network/DNS/TLS/timeout categories — not blanket url_rejected.
          bumpNetworkCategory(networkFailureCategory);
        } else {
          metrics.url_rejected++;
          if (
            /\b(?:identity|protected identity|target)\b/i.test(verification.rejection_reason ?? "")
          ) {
            metrics.identity_rejected++;
          }
          if (
            /\b(?:homepage|search|tag|category|listing|performer|page type)\b/i.test(
              verification.rejection_reason ?? "",
            )
          ) {
            metrics.page_type_rejected++;
          }
        }
        rejected.push(verification);
        continue;
      }

      metrics.crawl_succeeded++;

      if (seenCanonical.has(verification.canonical_url)) {
        metrics.url_rejected++;
        rejected.push({
          ...verification,
          url_verification_status: "URL_REJECTED",
          rejection_reason: "Duplicate canonical URL after redirect normalization.",
        });
        continue;
      }

      seenCanonical.add(verification.canonical_url);

      const mediaHits = (media ?? []).length
        ? media!
        : [
            {
              url: verification.final_url,
              query: hit.query,
              title: verification.page_title ?? undefined,
              description: verification.page_description ?? undefined,
              page_text: verification.page_text,
              page_inspected: true,
              evidence_page_url: verification.final_url,
            },
          ];

      for (const mediaHit of mediaHits) {
        const row = {
          ...hit,
          ...mediaHit,
          url: mediaHit.media_url ?? verification.final_url,
          title: verification.page_title ?? undefined,
          description: verification.page_description ?? undefined,
          discovered_url: verification.discovered_url,
          final_url: verification.final_url,
          canonical_url: verification.canonical_url,
          http_status: verification.http_status,
          redirect_chain: verification.redirect_chain,
          crawled_at: verification.crawled_at,
          page_title: verification.page_title,
          page_description: verification.page_description,
          page_text: verification.page_text,
          page_inspected: true,
          verified_domain: verification.verified_domain,
          url_verification_status: "URL_VERIFIED" as const,
          rejection_reason: null,
          evidence_page_url: verification.final_url,
        };
        verified.push(row);
        batchVerified.push(row);
      }
    }

    if (options?.onBatchComplete) {
      await options.onBatchComplete({
        batchIndex: Math.floor(start / batchSize),
        verifiedSoFar: verified.length,
        metrics: { ...metrics },
        verifiedBatch: batchVerified,
      });
    }
  }

  console.log("[DEEPFAKE:URL] Verification summary:", {
    submitted: limited.length,
    verifiedPages: seenCanonical.size,
    verifiedMediaRows: verified.length,
    rejected: rejected.length,
    crawlSucceeded: metrics.crawl_succeeded,
    crawlFailed: metrics.crawl_failed,
    rejectionSample: rejected.slice(0, 5).map((item) => ({
      url: item.discovered_url,
      final: item.final_url,
      reason: item.rejection_reason,
    })),
  });

  return { verified, rejected, metrics };
}
