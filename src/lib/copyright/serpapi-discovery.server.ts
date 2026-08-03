/**
 * Optional SerpApi Google Search discovery for Copyright Intelligence.
 *
 * Discovery-only — hits become page leads and must pass exact-page crawl,
 * exact-title identity, access-evidence, and client-visible gates.
 */

import { queryTitleVariants } from "./title-identity";
import type { ReferenceAnalysis, PageLead } from "./discover.server";
import { canonicalUrl, hostOf, isExcludedHost } from "./url.server";
import {
  isAbortError,
  isPastDiscoveryDeadline,
  parseRetryAfterMs,
  sleepWithAbort,
} from "./discovery-runtime";

export const COPYRIGHT_SERPAPI_MAX_HTTP_ATTEMPTS = 5;
export const COPYRIGHT_SERPAPI_MAX_UNIQUE_PAGES = 100;
export const COPYRIGHT_SERPAPI_MAX_RETRIES = 1;
export const COPYRIGHT_SERPAPI_REQUEST_TIMEOUT_MS = 12_000;

export interface SerpApiHttpBudget {
  remaining: number;
  used: number;
}

export interface SerpApiDiscoveryHit {
  url: string;
  title: string | null;
  text: string;
  query: string;
}

export interface SerpApiDiscoveryResult {
  hits: SerpApiDiscoveryHit[];
  pageLeads: PageLead[];
  requests: number;
  successes: number;
  failures: number;
  candidates: number;
  failureMessages: string[];
  configured: boolean;
}

export function isCopyrightSerpApiConfigured(): boolean {
  return Boolean(process.env.SERPAPI_API_KEY?.trim());
}

export function createSerpApiHttpBudget(max = COPYRIGHT_SERPAPI_MAX_HTTP_ATTEMPTS): SerpApiHttpBudget {
  return { remaining: max, used: 0 };
}

export function claimSerpApiHttpAttempt(budget: SerpApiHttpBudget): boolean {
  if (budget.remaining <= 0) return false;
  budget.remaining -= 1;
  budget.used += 1;
  return true;
}

/**
 * Exact quoted-title distribution queries only — never bare tokens.
 */
export function buildCopyrightSerpApiQueries(
  analysis: ReferenceAnalysis,
  workTitle: string,
  maxQueries = COPYRIGHT_SERPAPI_MAX_HTTP_ATTEMPTS,
): string[] {
  const primary = (analysis.title || workTitle).trim();
  if (!primary) return [];
  const names = queryTitleVariants(primary, [workTitle, analysis.title ?? "", ...analysis.altTitles]).slice(
    0,
    4,
  );
  const phrases = [
    "watch full movie online",
    "download full movie",
    "torrent magnet",
    "streaming server",
    "CAM HDCAM theatre print",
    "terabox OR mega OR pixeldrain",
    "bilibili OR dailymotion OR archive.org",
    "1080p 720p HDRip WEBRip mkv",
  ] as const;
  const out: string[] = [];
  for (const name of names) {
    const quoted = `"${name.replaceAll('"', "").trim()}"`;
    for (const phrase of phrases) {
      out.push(`${quoted} ${phrase}`);
      if (out.length >= maxQueries) return out;
    }
  }
  return out.slice(0, maxQueries);
}

function serpApiHitsFromPayload(payload: unknown, query: string): SerpApiDiscoveryHit[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const row = payload as Record<string, unknown>;
  const organic = Array.isArray(row.organic_results) ? row.organic_results : [];
  const hits: SerpApiDiscoveryHit[] = [];
  for (const raw of organic) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const link = typeof item.link === "string" ? item.link.trim() : "";
    if (!link.startsWith("http")) continue;
    const key = canonicalUrl(link);
    if (isExcludedHost(key)) continue;
    const title = typeof item.title === "string" ? item.title : null;
    const snippet = typeof item.snippet === "string" ? item.snippet : "";
    hits.push({
      url: key,
      title,
      text: `${title ?? ""} ${snippet} ${key}`,
      query,
    });
  }
  return hits;
}

function isTransientSerpApiFailure(status: number, error?: unknown): boolean {
  if (status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return /\b(?:timeout|timed out|429|rate.?limit|502|503|504|unavailable)\b/i.test(msg);
}

async function searchSerpApiOnce(
  query: string,
  signal?: AbortSignal,
  deadlineAt?: number,
): Promise<{ ok: boolean; payload: unknown; status: number; error: string | null }> {
  const key = process.env.SERPAPI_API_KEY?.trim();
  if (!key) {
    return { ok: false, payload: null, status: 0, error: "SERPAPI_API_KEY is not configured" };
  }
  const timeoutMs = Math.min(
    COPYRIGHT_SERPAPI_REQUEST_TIMEOUT_MS,
    typeof deadlineAt === "number" ? Math.max(1_000, deadlineAt - Date.now()) : COPYRIGHT_SERPAPI_REQUEST_TIMEOUT_MS,
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Timeout", "TimeoutError")), timeoutMs);
  const onParentAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onParentAbort, { once: true });

  try {
    const params = new URLSearchParams({
      engine: "google",
      q: query,
      api_key: key,
      num: "10",
    });
    const res = await fetch(`https://serpapi.com/search.json?${params}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        payload: text,
        status: res.status,
        error: `SerpApi HTTP ${res.status}`,
      };
    }
    try {
      return { ok: true, payload: JSON.parse(text), status: res.status, error: null };
    } catch {
      return { ok: false, payload: text, status: res.status, error: "SerpApi returned invalid JSON" };
    }
  } catch (error) {
    if (isAbortError(error)) throw error;
    return {
      ok: false,
      payload: null,
      status: 0,
      error: error instanceof Error ? error.message : "SerpApi request failed",
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onParentAbort);
  }
}

/**
 * Run bounded SerpApi Google Search discovery. Never throws on provider errors.
 */
export async function runCopyrightSerpApiDiscovery(input: {
  analysis: ReferenceAnalysis;
  workTitle: string;
  signal?: AbortSignal;
  deadlineAt?: number;
  budget?: SerpApiHttpBudget;
  onlyWhenFirecrawlFailed?: boolean;
  firecrawlHadSuccess?: boolean;
}): Promise<SerpApiDiscoveryResult> {
  const budget = input.budget ?? createSerpApiHttpBudget();
  const failureMessages: string[] = [];
  const hits: SerpApiDiscoveryHit[] = [];
  const seen = new Set<string>();
  let successes = 0;
  let failures = 0;

  if (!isCopyrightSerpApiConfigured()) {
    return {
      hits: [],
      pageLeads: [],
      requests: 0,
      successes: 0,
      failures: 0,
      candidates: 0,
      failureMessages: ["SERPAPI_API_KEY is not configured"],
      configured: false,
    };
  }

  if (input.onlyWhenFirecrawlFailed && input.firecrawlHadSuccess) {
    return {
      hits: [],
      pageLeads: [],
      requests: budget.used,
      successes: 0,
      failures: 0,
      candidates: 0,
      failureMessages: [],
      configured: true,
    };
  }

  const queries = buildCopyrightSerpApiQueries(input.analysis, input.workTitle, budget.remaining);
  for (const query of queries) {
    if (input.signal?.aborted) {
      throw input.signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    if (isPastDiscoveryDeadline(input.deadlineAt)) break;
    if (!claimSerpApiHttpAttempt(budget)) break;
    if (seen.size >= COPYRIGHT_SERPAPI_MAX_UNIQUE_PAGES) break;

    let lastError: string | null = null;
    let ok = false;
    let payload: unknown = null;

    for (let attempt = 0; attempt <= COPYRIGHT_SERPAPI_MAX_RETRIES; attempt++) {
      if (input.signal?.aborted) {
        throw input.signal.reason ?? new DOMException("Aborted", "AbortError");
      }
      if (isPastDiscoveryDeadline(input.deadlineAt)) break;
      const result = await searchSerpApiOnce(query, input.signal, input.deadlineAt);
      payload = result.payload;
      lastError = result.error;
      if (result.ok) {
        ok = true;
        break;
      }
      if (attempt < COPYRIGHT_SERPAPI_MAX_RETRIES && isTransientSerpApiFailure(result.status, result.error)) {
        const retryAfter =
          result.payload && typeof result.payload === "object" && !Array.isArray(result.payload)
            ? parseRetryAfterMs(
                String((result.payload as Record<string, unknown>)["retry-after"] ?? ""),
              )
            : null;
        await sleepWithAbort(retryAfter ?? 2_000 * (attempt + 1), input.signal);
        continue;
      }
      break;
    }

    if (!ok) {
      failures += 1;
      if (lastError) failureMessages.push(`${query}: ${lastError}`);
      continue;
    }

    successes += 1;
    for (const hit of serpApiHitsFromPayload(payload, query)) {
      if (seen.size >= COPYRIGHT_SERPAPI_MAX_UNIQUE_PAGES) break;
      if (seen.has(hit.url)) continue;
      seen.add(hit.url);
      hits.push(hit);
    }
  }

  const pageLeads: PageLead[] = hits.map((hit) => ({
    url: hit.url,
    title: hit.title,
    query: `serpapi:${hit.query}`,
    text: hit.text,
    strong: /\b(download|watch|stream|torrent|magnet|cam|hdrip|webrip)\b/i.test(hit.text),
  }));

  return {
    hits,
    pageLeads,
    requests: budget.used,
    successes,
    failures,
    candidates: hits.length,
    failureMessages,
    configured: true,
  };
}

/** Map SerpApi hits into lightweight discovery candidates for the image-less path. */
export function serpApiPageLeadHost(url: string): string {
  return hostOf(url) ?? "";
}
