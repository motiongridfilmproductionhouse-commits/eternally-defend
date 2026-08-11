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

const MAX_TEXT = 24_000;

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

export async function extractPage(url: string, timeoutMs = 15_000): Promise<ExtractedPage> {
  if (isCrawl4AiConfigured()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const rendered = await crawl4aiRenderPage(url, controller.signal);
      if (rendered.ok) {
        const text = (rendered.markdown || rendered.html || "").slice(0, MAX_TEXT);
        if (text.trim().length >= 200) {
          return {
            url,
            ok: true,
            pageText: text,
            pageTitle: rendered.pageTitle,
            extractor: "crawl4ai",
          };
        }
      }
    } catch {
      /* fall through to plain fetch */
    } finally {
      clearTimeout(timer);
    }
  }
  return plainFetch(url, timeoutMs);
}

/** Extract many pages with a bounded concurrency pool. */
export async function extractPages(
  urls: string[],
  opts: { concurrency?: number; timeoutMs?: number; max?: number } = {},
): Promise<Map<string, ExtractedPage>> {
  const concurrency = opts.concurrency ?? 6;
  const list = Array.from(new Set(urls)).slice(0, opts.max ?? 120);
  const out = new Map<string, ExtractedPage>();
  let cursor = 0;

  async function worker() {
    while (cursor < list.length) {
      const url = list[cursor++];
      try {
        out.set(url, await extractPage(url, opts.timeoutMs));
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
