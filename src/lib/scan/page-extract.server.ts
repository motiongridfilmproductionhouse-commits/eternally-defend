/**
 * Web Scan — full-page extraction layer.
 *
 * Crawl4AI (crawler-service) is the primary extractor; a plain fetch fallback
 * keeps the pipeline working when the crawler service is not configured, so
 * Firecrawl is never a required dependency for extraction.
 */

import { crawl4aiRenderPage, isCrawl4AiConfigured } from "@/lib/copyright/crawl4ai-render.server";

export interface ExtractedPage {
  url: string;
  ok: boolean;
  pageText: string;
  pageTitle: string | null;
  extractor: "crawl4ai" | "fetch" | "none";
  failureReason?: string;
}

/**
 * Extraction telemetry. Plain fetch is NEVER counted as a Crawl4AI success —
 * CRAWL4AI_SUCCESS and FETCH_FALLBACK_USED are reported separately.
 */
export type { ExtractionStats } from "./page-extract-types";
import type { ExtractionStats } from "./page-extract-types";

export function emptyExtractionStats(): ExtractionStats {
  const configured = isCrawl4AiConfigured();
  return {
    CRAWL4AI_CONFIGURED: configured,
    CRAWL4AI_ATTEMPTED: 0,
    CRAWL4AI_SUCCESS: 0,
    CRAWL4AI_FAILED: 0,
    FETCH_FALLBACK_USED: 0,
    FETCH_SUCCESS: 0,
    FETCH_FAILED: 0,
    crawl4ai_config_hint: configured
      ? undefined
      : "CRAWLER_SERVICE_URL is not set — set it to the deployed crawler-service origin (e.g. https://<host>) exposing GET /crawl?url=",
    crawl4ai_failure_samples: [],
    crawl4ai_avg_ms: 0,
    crawl4ai_total_ms: 0,
    crawl4ai_circuit_open_skips: 0,
  };
}


const MAX_TEXT = 24_000;

/**
 * Local mirror of the crawler service's circuit breaker. Once the service tells
 * us it is open, stop paying request latency for the rest of this window and go
 * straight to plain fetch.
 */
const BREAKER_COOLDOWN_MS = 60_000;
let breakerOpenUntil = 0;
function crawlerBreakerOpen(): boolean {
  return Date.now() < breakerOpenUntil;
}
function openCrawlerBreaker(): void {
  breakerOpenUntil = Date.now() + BREAKER_COOLDOWN_MS;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT);
}

async function plainFetch(url: string, timeoutMs: number): Promise<ExtractedPage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) {
      return {
        url,
        ok: false,
        pageText: "",
        pageTitle: null,
        extractor: "fetch",
        failureReason: `HTTP ${res.status}`,
      };
    }
    const html = await res.text();
    const titleMatch = html.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
    const text = htmlToText(html);
    return {
      url,
      ok: text.length >= 200,
      pageText: text,
      pageTitle: titleMatch ? htmlToText(titleMatch[1]) : null,
      extractor: "fetch",
      failureReason: text.length >= 200 ? undefined : "empty_page_text",
    };
  } catch (e) {
    return {
      url,
      ok: false,
      pageText: "",
      pageTitle: null,
      extractor: "fetch",
      failureReason: e instanceof Error ? e.message.slice(0, 160) : "fetch_failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function extractPage(
  url: string,
  timeoutMs = 15_000,
  stats?: ExtractionStats,
): Promise<ExtractedPage> {
  if (isCrawl4AiConfigured() && !crawlerBreakerOpen()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (stats) stats.CRAWL4AI_ATTEMPTED++;
    try {
      const rendered = await crawl4aiRenderPage(url, controller.signal);
      const elapsed = rendered.timingsMs?.total_ms;
      if (stats && typeof elapsed === "number") {
        stats.crawl4ai_total_ms = (stats.crawl4ai_total_ms ?? 0) + elapsed;
        const done = stats.CRAWL4AI_SUCCESS + stats.CRAWL4AI_FAILED + 1;
        stats.crawl4ai_avg_ms = Math.round((stats.crawl4ai_total_ms ?? 0) / done);
      }
      if (rendered.circuitOpen) {
        openCrawlerBreaker();
        if (stats) stats.crawl4ai_circuit_open_skips = (stats.crawl4ai_circuit_open_skips ?? 0) + 1;
      }
      if (rendered.ok) {
        const text = (rendered.markdown || rendered.html || "").slice(0, MAX_TEXT);
        if (text.trim().length >= 200) {
          if (stats) stats.CRAWL4AI_SUCCESS++;
          return {
            url,
            ok: true,
            pageText: text,
            pageTitle: rendered.pageTitle,
            extractor: "crawl4ai",
          };
        }
      }
      if (stats) {
        stats.CRAWL4AI_FAILED++;
        if (stats.crawl4ai_failure_samples.length < 5) {
          stats.crawl4ai_failure_samples.push(
            `${rendered.failureCategory ?? "empty"}: ${(rendered.failureReason ?? "no text").slice(0, 120)}`,
          );
        }
      }
    } catch (e) {
      if (stats) {
        stats.CRAWL4AI_FAILED++;
        if (stats.crawl4ai_failure_samples.length < 5) {
          stats.crawl4ai_failure_samples.push(
            e instanceof Error ? e.message.slice(0, 120) : "crawl4ai_failed",
          );
        }
      }
    } finally {
      clearTimeout(timer);
    }
  }
  if (stats) stats.FETCH_FALLBACK_USED++;
  const fetched = await plainFetch(url, timeoutMs);
  if (stats) {
    if (fetched.ok) stats.FETCH_SUCCESS++;
    else stats.FETCH_FAILED++;
  }
  return fetched;
}

/** Extract many pages with a bounded concurrency pool. */
export async function extractPages(
  urls: string[],
  opts: { concurrency?: number; timeoutMs?: number; max?: number; stats?: ExtractionStats } = {},
): Promise<Map<string, ExtractedPage>> {
  const concurrency = opts.concurrency ?? 6;
  const list = Array.from(new Set(urls)).slice(0, opts.max ?? 120);
  const out = new Map<string, ExtractedPage>();
  let cursor = 0;

  async function worker() {
    while (cursor < list.length) {
      const url = list[cursor++];
      try {
        out.set(url, await extractPage(url, opts.timeoutMs, opts.stats));
      } catch (e) {
        out.set(url, {
          url,
          ok: false,
          pageText: "",
          pageTitle: null,
          extractor: "none",
          failureReason: e instanceof Error ? e.message.slice(0, 160) : "extract_failed",
        });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
  return out;
}
