/**
 * Exact-page retrieval for Copyright Intelligence.
 *
 * Pipeline for each candidate URL:
 *  1. Safe DNS/SSRF validation
 *  2. Redirect validation (manual follow, re-validate each hop)
 *  3. Bounded static HTML retrieval
 *  4. Firecrawl rendered exact-page crawl when static HTML is insufficient
 *
 * Never bypasses auth, CAPTCHA, DRM, paywalls, or geo-blocks.
 * Network/render failures are categorized — never treated as content rejection.
 */

import {
  assertSafePublicUrlForFetch,
  classifySafeFetchFailure,
  fetchPublicHttpUrl,
  isSafePublicHttpUrl,
  MAX_SAFE_RESPONSE_BYTES,
  sanitizeProviderText,
} from "@/lib/deepfake/url-safety.server";
import { firecrawlFetch } from "@/lib/firecrawl-client.server";
import {
  mapSafeFetchToCrawlFailure,
  type CrawlFailureCategory,
} from "./crawl-failure";
import { canonicalUrl, hostOf } from "./url.server";

const USER_AGENT = "EternaSentinelCopyrightIntel/1.0";
const MAX_REDIRECTS = 6;
const STATIC_TIMEOUT_MS = 12_000;
const RENDER_TIMEOUT_MS = 25_000;
const MIN_USABLE_TEXT = 180;

export type RetrievalMethod = "static_html" | "firecrawl_render" | "none";

export interface PageRetrievalResult {
  ok: boolean;
  url: string;
  finalUrl: string;
  host: string | null;
  method: RetrievalMethod;
  markdown: string;
  html: string;
  links: string[];
  screenshot: string | null;
  pageTitle: string | null;
  metadata: Record<string, unknown>;
  rendered: boolean;
  failureCategory: CrawlFailureCategory | null;
  failureReason: string | null;
  httpStatus: number | null;
}

interface ScrapeInner {
  markdown?: string;
  html?: string;
  links?: string[];
  screenshot?: string;
  metadata?: Record<string, unknown>;
}

function emptyResult(
  url: string,
  failureCategory: CrawlFailureCategory,
  failureReason: string,
  extra?: Partial<PageRetrievalResult>,
): PageRetrievalResult {
  return {
    ok: false,
    url,
    finalUrl: url,
    host: hostOf(url),
    method: "none",
    markdown: "",
    html: "",
    links: [],
    screenshot: null,
    pageTitle: null,
    metadata: {},
    rendered: false,
    failureCategory,
    failureReason: sanitizeProviderText(failureReason, 240),
    httpStatus: null,
    ...extra,
  };
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw Object.assign(new Error("Aborted by deadline"), {
      failureCategory: "aborted_by_deadline" as const,
    });
  }
}

function mergeTimeoutSignal(
  parent: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!parent) return timeout;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([parent, timeout]);
  }
  const controller = new AbortController();
  const abort = () => controller.abort(parent.reason ?? timeout.reason);
  if (parent.aborted || timeout.aborted) {
    abort();
    return controller.signal;
  }
  parent.addEventListener("abort", abort, { once: true });
  timeout.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

function isHtmlMime(contentType: string | null): boolean {
  if (!contentType) return true;
  const ct = contentType.toLowerCase();
  return (
    ct.includes("text/html") ||
    ct.includes("application/xhtml") ||
    ct.includes("text/plain") ||
    ct.includes("application/octet-stream")
  );
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]{1,300})<\/title>/i);
  return m?.[1]?.replace(/\s+/g, " ").trim() || null;
}

function extractLinks(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  const re = /<a[^>]+href=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 80) {
    try {
      out.push(new URL(m[1]!, baseUrl).toString());
    } catch {
      // ignore bad hrefs
    }
  }
  return out;
}

function htmlToRoughMarkdown(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|br|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80_000);
}

/** Static HTML that is empty or clearly a JS shell needing render. */
export function needsRenderedFallback(html: string, markdown: string): boolean {
  const text = (markdown || htmlToRoughMarkdown(html)).trim();
  if (text.length < MIN_USABLE_TEXT) return true;
  const shell =
    /id=["']root["']|id=["']__next["']|id=["']app["']|data-reactroot|ng-app|window\.__INITIAL_STATE__/i.test(
      html,
    );
  const hasPlayerHints =
    /<iframe|<video|magnet:|\.m3u8|\.mpd|download|watch\s*now|jwplayer/i.test(
      `${html}\n${text}`,
    );
  if (shell && !hasPlayerHints && text.length < 800) return true;
  return false;
}

async function followRedirects(
  startUrl: string,
  signal?: AbortSignal,
): Promise<{
  ok: boolean;
  finalUrl: string;
  status: number;
  failureCategory?: CrawlFailureCategory;
  failureReason?: string;
}> {
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    assertNotAborted(signal);
    const hopSignal = mergeTimeoutSignal(signal, STATIC_TIMEOUT_MS);
    try {
      await assertSafePublicUrlForFetch(current, undefined, hopSignal);
    } catch (e) {
      return {
        ok: false,
        finalUrl: current,
        status: 0,
        failureCategory: mapSafeFetchToCrawlFailure(
          classifySafeFetchFailure(e),
          e,
        ),
        failureReason: e instanceof Error ? e.message : "URL safety failed",
      };
    }

    let response: Response;
    try {
      response = await fetchPublicHttpUrl(current, {
        method: "GET",
        signal: hopSignal,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        },
      });
    } catch (e) {
      return {
        ok: false,
        finalUrl: current,
        status: 0,
        failureCategory: mapSafeFetchToCrawlFailure(
          classifySafeFetchFailure(e),
          e,
        ),
        failureReason: e instanceof Error ? e.message : "Connect failed",
      };
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      try {
        void response.body?.cancel();
      } catch {
        /* ignore */
      }
      if (!location) {
        return {
          ok: false,
          finalUrl: current,
          status: response.status,
          failureCategory: "redirect_rejected",
          failureReason: "Redirect missing Location header",
        };
      }
      let next: string;
      try {
        next = new URL(location, current).toString();
      } catch {
        return {
          ok: false,
          finalUrl: current,
          status: response.status,
          failureCategory: "redirect_rejected",
          failureReason: "Invalid redirect Location",
        };
      }
      if (!isSafePublicHttpUrl(next)) {
        return {
          ok: false,
          finalUrl: current,
          status: response.status,
          failureCategory: "redirect_rejected",
          failureReason: "Redirect target failed public URL safety",
        };
      }
      current = next;
      continue;
    }

    // Final hop validated — release probe body; caller performs the content GET.
    try {
      void response.body?.cancel();
    } catch {
      /* ignore */
    }
    return { ok: true, finalUrl: current, status: response.status };
  }

  return {
    ok: false,
    finalUrl: current,
    status: 0,
    failureCategory: "redirect_rejected",
    failureReason: "Too many redirects",
  };
}

async function fetchStaticHtml(
  url: string,
  signal?: AbortSignal,
): Promise<{
  ok: boolean;
  html: string;
  status: number;
  contentType: string | null;
  failureCategory?: CrawlFailureCategory;
  failureReason?: string;
}> {
  const hopSignal = mergeTimeoutSignal(signal, STATIC_TIMEOUT_MS);
  try {
    await assertSafePublicUrlForFetch(url, undefined, hopSignal);
    const response = await fetchPublicHttpUrl(url, {
      method: "GET",
      signal: hopSignal,
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      },
    });

    if (response.status === 403) {
      try {
        void response.body?.cancel();
      } catch {
        /* ignore */
      }
      return {
        ok: false,
        html: "",
        status: 403,
        contentType: response.headers.get("content-type"),
        failureCategory: "blocked_403",
        failureReason: "HTTP 403 Forbidden",
      };
    }

    if (response.status === 404) {
      try {
        void response.body?.cancel();
      } catch {
        /* ignore */
      }
      return {
        ok: false,
        html: "",
        status: 404,
        contentType: response.headers.get("content-type"),
        failureCategory: "connect_failure",
        failureReason: "HTTP 404 Not Found",
      };
    }

    if (!response.ok && response.status >= 400) {
      try {
        void response.body?.cancel();
      } catch {
        /* ignore */
      }
      return {
        ok: false,
        html: "",
        status: response.status,
        contentType: response.headers.get("content-type"),
        failureCategory: response.status === 403 ? "blocked_403" : "connect_failure",
        failureReason: `HTTP ${response.status}`,
      };
    }

    const contentType = response.headers.get("content-type");
    if (!isHtmlMime(contentType)) {
      try {
        void response.body?.cancel();
      } catch {
        /* ignore */
      }
      return {
        ok: false,
        html: "",
        status: response.status,
        contentType,
        failureCategory: "unsupported_mime",
        failureReason: `Unsupported MIME: ${contentType ?? "unknown"}`,
      };
    }

    const lengthHeader = response.headers.get("content-length");
    if (lengthHeader && Number(lengthHeader) > MAX_SAFE_RESPONSE_BYTES) {
      try {
        void response.body?.cancel();
      } catch {
        /* ignore */
      }
      return {
        ok: false,
        html: "",
        status: response.status,
        contentType,
        failureCategory: "response_too_large",
        failureReason: "Response exceeded size limit",
      };
    }

    const buf = new Uint8Array(await response.arrayBuffer());
    if (buf.byteLength > MAX_SAFE_RESPONSE_BYTES) {
      return {
        ok: false,
        html: "",
        status: response.status,
        contentType,
        failureCategory: "response_too_large",
        failureReason: "Response body exceeded size limit",
      };
    }

    const html = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    if (!html.trim()) {
      return {
        ok: false,
        html: "",
        status: response.status,
        contentType,
        failureCategory: "empty_static_html",
        failureReason: "Empty static HTML body",
      };
    }

    // Soft robots signal in body (never bypass; just record).
    if (/robots?\s*txt|access denied by robots/i.test(html) && html.length < 400) {
      return {
        ok: false,
        html,
        status: response.status,
        contentType,
        failureCategory: "blocked_robots",
        failureReason: "Page indicates robots/access denial",
      };
    }

    return { ok: true, html, status: response.status, contentType };
  } catch (e) {
    if (signal?.aborted) {
      return {
        ok: false,
        html: "",
        status: 0,
        contentType: null,
        failureCategory: "aborted_by_deadline",
        failureReason: "Aborted by deadline",
      };
    }
    return {
      ok: false,
      html: "",
      status: 0,
      contentType: null,
      failureCategory: mapSafeFetchToCrawlFailure(classifySafeFetchFailure(e), e),
      failureReason: e instanceof Error ? e.message : "Static fetch failed",
    };
  }
}

async function firecrawlRender(
  url: string,
  signal?: AbortSignal,
  proxy: "basic" | "stealth" = "basic",
): Promise<{
  ok: boolean;
  data: ScrapeInner | null;
  failureCategory?: CrawlFailureCategory;
  failureReason?: string;
}> {
  assertNotAborted(signal);
  const hopSignal = mergeTimeoutSignal(signal, RENDER_TIMEOUT_MS);
  try {
    const res = await firecrawlFetch(
      "/scrape",
      {
        url,
        formats: ["markdown", "html", "links", "screenshot"],
        onlyMainContent: false,
        waitFor: 2500,
        // Piracy hosts frequently block plain crawlers; the caller retries with
        // the stealth proxy so those pages still yield evidence.
        proxy,
      },
      { signal: hopSignal },
    );
    if (!res.ok) {
      const status = res.status;
      return {
        ok: false,
        data: null,
        failureCategory:
          status === 403
            ? "blocked_403"
            : status === 408 || status === 504
              ? "timeout"
              : "provider_failure",
        failureReason: `Firecrawl scrape HTTP ${status}`,
      };
    }
    const json = (await res.json()) as {
      success?: boolean;
      data?: ScrapeInner;
      error?: string;
      markdown?: string;
      html?: string;
      links?: string[];
      screenshot?: string;
      metadata?: Record<string, unknown>;
    };
    const inner = (json.data ?? json) as ScrapeInner;
    const html = inner.html ?? "";
    const markdown = inner.markdown ?? "";
    if (!html.trim() && !markdown.trim()) {
      return {
        ok: false,
        data: null,
        failureCategory: "render_failure",
        failureReason: sanitizeProviderText(
          json.error || "Firecrawl returned empty rendered content",
          240,
        ),
      };
    }
    return { ok: true, data: inner };
  } catch (e) {
    if (signal?.aborted) {
      return {
        ok: false,
        data: null,
        failureCategory: "aborted_by_deadline",
        failureReason: "Aborted by deadline during render",
      };
    }
    return {
      ok: false,
      data: null,
      failureCategory: mapSafeFetchToCrawlFailure(classifySafeFetchFailure(e), e) ===
      "provider_failure"
        ? "provider_failure"
        : mapSafeFetchToCrawlFailure(classifySafeFetchFailure(e), e) === "timeout"
          ? "timeout"
          : "render_failure",
      failureReason: e instanceof Error ? e.message : "Render failed",
    };
  }
}

function normalizeShot(shot: string | undefined): string | null {
  if (!shot) return null;
  return shot.startsWith("data:") || shot.startsWith("http")
    ? shot
    : `data:image/png;base64,${shot}`;
}

/**
 * Retrieve one exact public page with static-then-rendered fallback.
 */
export async function retrieveCopyrightPage(
  url: string,
  options?: {
    signal?: AbortSignal;
    /** Prefer render even when static HTML looks usable (known evidence URLs). */
    preferRender?: boolean;
  },
): Promise<PageRetrievalResult> {
  const signal = options?.signal;
  const start = canonicalUrl(url);

  if (!isSafePublicHttpUrl(start)) {
    return emptyResult(start, "private_or_reserved_address", "URL failed public http(s) safety checks");
  }

  try {
    assertNotAborted(signal);
  } catch {
    return emptyResult(start, "aborted_by_deadline", "Aborted before retrieval");
  }

  // 1–2. DNS/SSRF + redirect validation
  const redirected = await followRedirects(start, signal);
  if (!redirected.ok) {
    return emptyResult(
      start,
      redirected.failureCategory ?? "redirect_rejected",
      redirected.failureReason ?? "Redirect validation failed",
      { finalUrl: redirected.finalUrl, httpStatus: redirected.status },
    );
  }

  const finalUrl = canonicalUrl(redirected.finalUrl);

  // 3. Bounded static HTML
  const staticPage = await fetchStaticHtml(finalUrl, signal);
  let html = staticPage.ok ? staticPage.html : "";
  let markdown = html ? htmlToRoughMarkdown(html) : "";
  let links = html ? extractLinks(html, finalUrl) : [];
  let pageTitle = html ? extractTitle(html) : null;
  let screenshot: string | null = null;
  let metadata: Record<string, unknown> = {};
  let method: RetrievalMethod = "none";
  let rendered = false;

  const staticUsable =
    staticPage.ok && !needsRenderedFallback(html, markdown) && !options?.preferRender;

  if (staticUsable) {
    method = "static_html";
    return {
      ok: true,
      url: start,
      finalUrl,
      host: hostOf(finalUrl),
      method,
      markdown,
      html,
      links,
      screenshot,
      pageTitle,
      metadata,
      rendered: false,
      failureCategory: null,
      failureReason: null,
      httpStatus: staticPage.status,
    };
  }

  // 4. Firecrawl rendered exact-page fallback (stealth retry when blocked)
  let renderedPage = await firecrawlRender(finalUrl, signal);
  if (
    !renderedPage.ok &&
    (renderedPage.failureCategory === "blocked_403" ||
      renderedPage.failureCategory === "render_failure" ||
      renderedPage.failureCategory === "provider_failure")
  ) {
    renderedPage = await firecrawlRender(finalUrl, signal, "stealth");
  }
  if (renderedPage.ok && renderedPage.data) {
    const data = renderedPage.data;
    html = data.html ?? html;
    markdown = data.markdown ?? markdown;
    links = (Array.isArray(data.links) ? data.links : links).filter(
      (l): l is string => typeof l === "string",
    );
    metadata = (data.metadata ?? {}) as Record<string, unknown>;
    pageTitle =
      (typeof metadata.title === "string" && metadata.title) ||
      extractTitle(html) ||
      pageTitle;
    screenshot = normalizeShot(data.screenshot);
    method = "firecrawl_render";
    rendered = true;
    return {
      ok: true,
      url: start,
      finalUrl,
      host: hostOf(finalUrl),
      method,
      markdown,
      html,
      links,
      screenshot,
      pageTitle,
      metadata,
      rendered,
      failureCategory: null,
      failureReason: null,
      httpStatus: staticPage.status || redirected.status,
    };
  }

  // Prefer-render requested but render failed — keep usable static HTML if present.
  if (
    staticPage.ok &&
    html.trim() &&
    !needsRenderedFallback(html, markdown)
  ) {
    return {
      ok: true,
      url: start,
      finalUrl,
      host: hostOf(finalUrl),
      method: "static_html",
      markdown,
      html,
      links,
      screenshot: null,
      pageTitle,
      metadata: {},
      rendered: false,
      failureCategory: null,
      failureReason: null,
      httpStatus: staticPage.status,
    };
  }

  // Static was empty/insufficient and render failed — report the best failure.
  if (staticPage.ok && html.trim()) {
    return emptyResult(
      start,
      renderedPage.failureCategory ?? "empty_static_html",
      renderedPage.failureReason ??
        "Static HTML lacked usable content and rendered fallback failed",
      {
        finalUrl,
        html,
        markdown,
        links,
        pageTitle,
        httpStatus: staticPage.status,
        method: "none",
      },
    );
  }

  if (!staticPage.ok) {
    return emptyResult(
      start,
      staticPage.failureCategory ??
        renderedPage.failureCategory ??
        "empty_static_html",
      staticPage.failureReason ??
        renderedPage.failureReason ??
        "Static HTML retrieval failed",
      { finalUrl, httpStatus: staticPage.status },
    );
  }

  return emptyResult(
    start,
    renderedPage.failureCategory ?? "empty_static_html",
    renderedPage.failureReason ?? "No usable page content retrieved",
    { finalUrl, httpStatus: staticPage.status },
  );
}
