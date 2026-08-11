/**
 * Optional Crawl4AI render fallback for Copyright Intelligence page retrieval.
 * Uses the existing crawler-service when CRAWLER_SERVICE_URL is configured.
 */

import { sanitizeProviderText } from "@/lib/deepfake/url-safety.server";
import type { CrawlFailureCategory } from "./crawl-failure";
import { mapSafeFetchToCrawlFailure } from "./crawl-failure";
import { classifySafeFetchFailure } from "@/lib/deepfake/url-safety.server";

export interface Crawl4AiRenderResult {
  ok: boolean;
  html: string;
  markdown: string;
  links: string[];
  pageTitle: string | null;
  metadata: Record<string, unknown>;
  failureCategory?: CrawlFailureCategory;
  failureReason?: string;
  /** Per-stage timings reported by the crawler service (warm browser profile). */
  timingsMs?: Record<string, number>;
  /** True when the crawler service short-circuited via its breaker. */
  circuitOpen?: boolean;
}

export function isCrawl4AiConfigured(): boolean {
  return Boolean(
    process.env.CRAWLER_SERVICE_URL?.trim() || process.env.CRAWL4AI_SERVICE_URL?.trim(),
  );
}

function crawlerServiceBase(): string | null {
  const raw =
    process.env.CRAWLER_SERVICE_URL?.trim() || process.env.CRAWL4AI_SERVICE_URL?.trim() || "";
  if (!raw) return null;
  return raw.replace(/\/$/, "");
}

export async function crawl4aiRenderPage(
  url: string,
  signal?: AbortSignal,
): Promise<Crawl4AiRenderResult> {
  const base = crawlerServiceBase();
  if (!base) {
    return {
      ok: false,
      html: "",
      markdown: "",
      links: [],
      pageTitle: null,
      metadata: {},
      failureCategory: "provider_failure",
      failureReason: "Crawl4AI service URL is not configured",
    };
  }

  try {
    const endpoint = new URL("/crawl", base);
    endpoint.searchParams.set("url", url);
    const response = await fetch(endpoint.toString(), {
      method: "GET",
      signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      // 503 = crawler breaker open or saturated: fail fast so the caller can
      // fall back to plain fetch instead of burning its timeout budget.
      let reason = `Crawl4AI HTTP ${response.status}`;
      let circuitOpen = false;
      if (response.status === 503) {
        try {
          const body = (await response.json()) as {
            failure_category?: string;
            failure_reason?: string;
          };
          circuitOpen = body.failure_category === "circuit_open";
          reason = `${body.failure_category ?? "unavailable"}: ${body.failure_reason ?? reason}`;
        } catch {
          /* keep default reason */
        }
      }
      return {
        ok: false,
        html: "",
        markdown: "",
        links: [],
        pageTitle: null,
        metadata: {},
        circuitOpen,
        failureCategory: response.status === 403 ? "access_denied" : "provider_failure",
        failureReason: reason,
      };
    }
    const json = (await response.json()) as {
      success?: boolean;
      title?: string;
      markdown?: string;
      links?: unknown;
      media?: unknown;
      url?: string;
      failure_category?: string;
      failure_reason?: string;
      timings_ms?: Record<string, number>;
    };
    const markdown = typeof json.markdown === "string" ? json.markdown : "";
    const links = normalizeLinks(json.links);

    const pageTitle = typeof json.title === "string" ? json.title : null;
    if (!json.success || (!markdown.trim() && links.length === 0)) {
      return {
        ok: false,
        html: "",
        markdown,
        links,
        pageTitle,
        metadata: { source: "crawl4ai" },
        timingsMs: json.timings_ms,
        failureCategory:
          json.failure_category === "navigation_timeout" ? "navigation_timeout" : "browser_render_empty",
        failureReason:
          json.failure_reason ?? "Crawl4AI returned empty rendered content",
      };
    }
    return {
      ok: true,
      html: markdown,
      markdown,
      links,
      pageTitle,
      metadata: { source: "crawl4ai", final_url: json.url ?? url },
      timingsMs: json.timings_ms,
    };
  } catch (e) {
    if (signal?.aborted) {
      return {
        ok: false,
        html: "",
        markdown: "",
        links: [],
        pageTitle: null,
        metadata: {},
        failureCategory: "navigation_timeout",
        failureReason: "Crawl4AI request aborted",
      };
    }
    return {
      ok: false,
      html: "",
      markdown: "",
      links: [],
      pageTitle: null,
      metadata: {},
      failureCategory: mapSafeFetchToCrawlFailure(classifySafeFetchFailure(e), e),
      failureReason: sanitizeProviderText(e instanceof Error ? e.message : String(e), 240),
    };
  }
}
