/**
 * Server-only: live health/quota probe for the image-discovery providers used
 * by the deepfake pipeline.
 *
 * Why this exists: when every discovery provider is down or out of quota, the
 * pipeline previously returned zero hits and the scan was persisted as
 * "completed" with no findings. Operators and clients could not distinguish
 * "nothing found" from "nothing searched". This module makes the outage
 * explicit so the worker can fail the scan with an actionable reason.
 *
 * No enforcement or external action is taken here — read-only probes.
 */

import { braveApiKey, crawlerServiceUrl, serpApiKey } from "./provider-keys.server";

export type ProviderState = "available" | "unconfigured" | "quota_exhausted" | "unreachable";

export interface ProviderHealth {
  provider: "crawler_service" | "serpapi" | "brave_images";
  state: ProviderState;
  detail: string | null;
}

export interface DiscoveryProviderHealthReport {
  providers: ProviderHealth[];
  available: string[];
  anyAvailable: boolean;
  summary: string;
  checked_at: string;
}

const PROBE_TIMEOUT_MS = 6000;
const CACHE_TTL_MS = 5 * 60 * 1000;

let cache: { at: number; report: DiscoveryProviderHealthReport } | null = null;

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function probeCrawlerService(): Promise<ProviderHealth> {
  const base = crawlerServiceUrl();
  if (!base) {
    return { provider: "crawler_service", state: "unconfigured", detail: "CRAWLER_SERVICE_URL not set" };
  }
  try {
    return await withTimeout(async (signal) => {
      const response = await fetch(`${base}/health`, { method: "GET", signal });
      if (!response.ok) {
        return {
          provider: "crawler_service" as const,
          state: "unreachable" as const,
          detail: `health check returned HTTP ${response.status}`,
        };
      }
      return { provider: "crawler_service" as const, state: "available" as const, detail: null };
    });
  } catch (error) {
    return { provider: "crawler_service", state: "unreachable", detail: errorText(error).slice(0, 200) };
  }
}

async function probeSerpApi(): Promise<ProviderHealth> {
  const key = serpApiKey();
  if (!key) {
    return { provider: "serpapi", state: "unconfigured", detail: "SerpApi key not set" };
  }
  try {
    return await withTimeout(async (signal) => {
      const response = await fetch(
        `https://serpapi.com/account?api_key=${encodeURIComponent(key)}`,
        { signal },
      );
      if (response.status === 401 || response.status === 403) {
        return { provider: "serpapi" as const, state: "unreachable" as const, detail: "invalid API key" };
      }
      if (!response.ok) {
        return {
          provider: "serpapi" as const,
          state: "unreachable" as const,
          detail: `account check returned HTTP ${response.status}`,
        };
      }
      const payload = (await response.json()) as { total_searches_left?: number };
      const left = typeof payload.total_searches_left === "number" ? payload.total_searches_left : null;
      if (left !== null && left <= 0) {
        return {
          provider: "serpapi" as const,
          state: "quota_exhausted" as const,
          detail: "0 searches left on the current SerpApi plan",
        };
      }
      return {
        provider: "serpapi" as const,
        state: "available" as const,
        detail: left === null ? null : `${left} searches left`,
      };
    });
  } catch (error) {
    return { provider: "serpapi", state: "unreachable", detail: errorText(error).slice(0, 200) };
  }
}

async function probeBrave(): Promise<ProviderHealth> {
  const key = braveApiKey();
  if (!key) {
    return { provider: "brave_images", state: "unconfigured", detail: "BRAVE_API_KEY not set" };
  }
  try {
    return await withTimeout(async (signal) => {
      const response = await fetch(
        "https://api.search.brave.com/res/v1/images/search?q=health&count=1",
        {
          headers: { "X-Subscription-Token": key, Accept: "application/json" },
          signal,
        },
      );
      if (response.status === 402 || response.status === 429) {
        return {
          provider: "brave_images" as const,
          state: "quota_exhausted" as const,
          detail: `Brave Search usage limit reached (HTTP ${response.status})`,
        };
      }
      if (response.status === 401 || response.status === 403) {
        return { provider: "brave_images" as const, state: "unreachable" as const, detail: "invalid API key" };
      }
      if (!response.ok) {
        return {
          provider: "brave_images" as const,
          state: "unreachable" as const,
          detail: `image search returned HTTP ${response.status}`,
        };
      }
      return { provider: "brave_images" as const, state: "available" as const, detail: null };
    });
  } catch (error) {
    return { provider: "brave_images", state: "unreachable", detail: errorText(error).slice(0, 200) };
  }
}

/** Pure decision helper — kept separate so it is unit testable. */
export function summarizeProviderHealth(providers: ProviderHealth[]): {
  available: string[];
  anyAvailable: boolean;
  summary: string;
} {
  const available = providers.filter((p) => p.state === "available").map((p) => p.provider);
  if (available.length > 0) {
    return {
      available,
      anyAvailable: true,
      summary: `Image discovery available via ${available.join(", ")}.`,
    };
  }
  const reasons = providers.map((p) => `${p.provider}: ${p.state}${p.detail ? ` (${p.detail})` : ""}`);
  return {
    available,
    anyAvailable: false,
    summary: `No image-discovery provider is usable — ${reasons.join("; ")}. Scan did not search; this is an infrastructure/quota issue, not a "no results" result.`,
  };
}

export async function checkDiscoveryProviderHealth(options?: {
  force?: boolean;
}): Promise<DiscoveryProviderHealthReport> {
  if (!options?.force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.report;
  }
  const providers = await Promise.all([probeCrawlerService(), probeSerpApi(), probeBrave()]);
  const report: DiscoveryProviderHealthReport = {
    providers,
    ...summarizeProviderHealth(providers),
    checked_at: new Date().toISOString(),
  };
  cache = { at: Date.now(), report };
  return report;
}
