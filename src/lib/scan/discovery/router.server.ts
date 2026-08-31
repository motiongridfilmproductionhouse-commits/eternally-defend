/**
 * Web Scan — Discovery Router.
 *
 *   Query → Router → all healthy configured providers → merge → canonical
 *   dedup → candidate pool
 *
 * Firecrawl is one OPTIONAL provider among several. When a provider returns
 * 402 (credits), 429 (rate limit), a timeout, an auth failure, or is otherwise
 * unavailable, it is marked unhealthy FOR THIS SCAN ONLY and every remaining
 * configured provider keeps serving discovery — a single provider outage can
 * never zero out general-web discovery.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { ProviderError, type SearchProviderAdapter } from "./provider";
import { braveProvider } from "./brave-provider.server";
import { firecrawlProvider } from "./firecrawl-provider.server";
import { geminiGroundingProvider } from "./gemini-grounding-provider.server";
import { googleProvider } from "./google-provider.server";
import { hikerapiProvider } from "./hikerapi-provider.server";
import { serpapiProvider } from "./serpapi-provider.server";
import type {
  DiscoveryHit,
  DiscoveryRouterReport,
  ProviderFailureKind,
  ProviderHealthReport,
  ProviderId,
  ProviderState,
} from "./types";

const FAILURE_STATE: Record<ProviderFailureKind, ProviderState> = {
  credits_exhausted: "CREDITS_EXHAUSTED",
  rate_limited: "RATE_LIMITED",
  auth_failed: "AUTH_FAILED",
  timeout: "TIMEOUT",
  unavailable: "UNAVAILABLE",
  bad_response: "UNAVAILABLE",
};

/**
 * Failures that permanently disable a provider for the scan. Transient
 * failures (single timeout / one bad response) only count against the
 * provider after repeated occurrences.
 */
const FATAL_KINDS: ProviderFailureKind[] = ["credits_exhausted", "auth_failed"];
const MAX_TRANSIENT_FAILURES = 3;

interface ProviderRuntime {
  adapter: SearchProviderAdapter;
  health: ProviderHealthReport;
  transientFailures: number;
}

export function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.hostname = u.hostname.replace(/^www\./i, "").toLowerCase();
    for (const p of Array.from(u.searchParams.keys())) {
      if (/^(utm_|fbclid|gclid|igshid|ref|ref_src|si$)/i.test(p)) u.searchParams.delete(p);
    }
    let path = u.pathname.replace(/\/+$/, "");
    if (!path) path = "/";
    u.pathname = path;
    return `${u.protocol}//${u.hostname}${u.pathname}${u.search}`;
  } catch {
    return raw.trim();
  }
}

export function normalizeQuery(q: string): string {
  return q.trim().replace(/\s+/g, " ").toLowerCase();
}

export interface DiscoveryRouterOptions {
  /** Restrict to a provider subset (defaults to all registered providers). */
  only?: ProviderId[];
  /** Force-disable providers (used for the Firecrawl-unavailable acceptance run). */
  disable?: ProviderId[];
  /** Override the adapter registry (tests only). */
  adapters?: SearchProviderAdapter[];
}

export class DiscoveryRouter {
  private runtimes: ProviderRuntime[] = [];
  private executedQueries = new Map<string, string>();
  private duplicatesPrevented = 0;
  private queriesAttempted = 0;
  private queriesFailedEverywhere = 0;
  private seenUrls = new Set<string>();
  private duplicatesRemoved = 0;
  private urlsReturned = 0;

  constructor(options: DiscoveryRouterOptions = {}) {
    const registry: SearchProviderAdapter[] =
      options.adapters ??
      // Brave stays primary discovery; Gemini grounding is the Google-backed layer.
      // googleProvider (Custom Search JSON API) is retained but disabled by default.
      // hikerapiProvider is Instagram-specific and off by default (HIKERAPI_ENABLED)
      // until explicitly turned on — see hikerapi-provider.server.ts's isConfigured().
      [
        braveProvider,
        geminiGroundingProvider,
        firecrawlProvider,
        serpapiProvider,
        googleProvider,
        hikerapiProvider,
      ];
    const disabled = new Set(options.disable ?? []);
    const envDisabled = new Set(
      (process.env.SCAN_DISABLE_PROVIDERS ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    );

    for (const adapter of registry) {
      if (options.only && !options.only.includes(adapter.id)) continue;
      const forcedOff = disabled.has(adapter.id) || envDisabled.has(adapter.id);
      const configured = !forcedOff && adapter.isConfigured();
      this.runtimes.push({
        adapter,
        transientFailures: 0,
        health: {
          provider: adapter.id,
          configured,
          healthy: configured,
          state: configured ? "HEALTHY" : "NOT_CONFIGURED",
          queriesAttempted: 0,
          queriesSuccessful: 0,
          queriesFailed: 0,
          urlsReturned: 0,
          rateLimited: false,
          creditsExhausted: false,
          latencyMsTotal: 0,
          latencyMsAvg: 0,
          failureReason: forcedOff
            ? "disabled for this scan"
            : configured
              ? undefined
              : "credential not configured",
        },
      });
    }
  }

  /** Providers currently able to serve a query. */
  healthyProviders(): ProviderId[] {
    return this.runtimes.filter((r) => r.health.healthy).map((r) => r.adapter.id);
  }

  hasHealthyProvider(): boolean {
    return this.runtimes.some((r) => r.health.healthy);
  }

  /** Normalized list of every query the router actually dispatched. */
  executed(): string[] {
    return Array.from(this.executedQueries.values());
  }

  /** True when this exact query already ran during this scan. */
  isDuplicateQuery(query: string): boolean {
    return this.executedQueries.has(normalizeQuery(query));
  }

  /**
   * Execute one query across every healthy provider, merge and dedupe.
   * Never throws for provider failures — the failure lands in provider health.
   */
  async search(
    query: string,
    limit = 5,
    opts: { skipDuplicates?: boolean; signal?: AbortSignal } = {},
  ): Promise<DiscoveryHit[]> {
    const clean = query.trim().replace(/\s+/g, " ");
    if (!clean) return [];
    const key = normalizeQuery(clean);

    if (this.executedQueries.has(key)) {
      this.duplicatesPrevented++;
      if (opts.skipDuplicates) return [];
    } else {
      this.executedQueries.set(key, clean);
    }

    this.queriesAttempted++;

    const active = this.runtimes.filter((r) => r.health.healthy);
    if (!active.length) {
      this.queriesFailedEverywhere++;
      return [];
    }

    const results = await Promise.all(
      active.map(async (runtime) => {
        runtime.health.queriesAttempted++;
        const started = Date.now();
        try {
          const hits = await runtime.adapter.search(clean, limit, opts.signal);
          const latency = Date.now() - started;
          runtime.health.latencyMsTotal += latency;
          runtime.health.queriesSuccessful++;
          runtime.health.urlsReturned += hits.length;
          runtime.health.latencyMsAvg = Math.round(
            runtime.health.latencyMsTotal / Math.max(runtime.health.queriesSuccessful, 1),
          );
          return hits.map((h) => ({ ...h, queryUsed: clean, provider: runtime.adapter.id }));
        } catch (e) {
          runtime.health.latencyMsTotal += Date.now() - started;
          runtime.health.queriesFailed++;
          this.recordFailure(runtime, e);
          return [] as DiscoveryHit[];
        }
      }),
    );

    const merged: DiscoveryHit[] = [];
    for (const hits of results) {
      for (const hit of hits) {
        if (!hit.url) continue;
        this.urlsReturned++;
        const canon = canonicalizeUrl(hit.url);
        if (this.seenUrls.has(canon)) {
          this.duplicatesRemoved++;
          continue;
        }
        this.seenUrls.add(canon);
        merged.push(hit);
      }
    }

    if (!merged.length && results.every((r) => r.length === 0)) {
      const allFailed = active.every((r) => r.health.queriesFailed > 0 && !r.health.healthy);
      if (allFailed) this.queriesFailedEverywhere++;
    }

    return merged;
  }

  private recordFailure(runtime: ProviderRuntime, error: unknown): void {
    const kind: ProviderFailureKind =
      error instanceof ProviderError ? error.kind : "unavailable";
    const message =
      error instanceof Error ? error.message.slice(0, 220) : String(error).slice(0, 220);

    if (kind === "rate_limited") runtime.health.rateLimited = true;
    if (kind === "credits_exhausted") runtime.health.creditsExhausted = true;
    runtime.health.failureReason = message;

    const fatal = FATAL_KINDS.includes(kind);
    if (!fatal) {
      runtime.transientFailures++;
      // Rate limits burn the provider quickly — retrying floods the API.
      const cap = kind === "rate_limited" ? 2 : MAX_TRANSIENT_FAILURES;
      if (runtime.transientFailures < cap) {
        runtime.health.state = FAILURE_STATE[kind];
        return;
      }
    }

    runtime.health.healthy = false;
    runtime.health.state = FAILURE_STATE[kind];
    console.warn(
      `[scan:discovery] provider=${runtime.adapter.id} marked unhealthy state=${runtime.health.state} reason=${message}`,
    );
  }

  report(): DiscoveryRouterReport {
    return {
      providers: this.runtimes.map((r) => ({ ...r.health })),
      queries: {
        attempted: this.queriesAttempted,
        executed: this.executedQueries.size,
        duplicatesPrevented: this.duplicatesPrevented,
        failed: this.queriesFailedEverywhere,
      },
      urls_returned: this.urlsReturned,
      urls_unique: this.seenUrls.size,
      duplicates_removed: this.duplicatesRemoved,
      all_providers_down: !this.hasHealthyProvider(),
    };
  }
}

/* ── Per-request router context ──────────────────────────────────────────────
 * Discovery helpers deep inside the scan pipeline resolve the active router
 * from async context, so no signature threading is required and concurrent
 * scans never share provider health or query registries.
 */
const routerStore = new AsyncLocalStorage<DiscoveryRouter>();

export function withDiscoveryRouter<T>(router: DiscoveryRouter, fn: () => Promise<T>): Promise<T> {
  return routerStore.run(router, fn);
}

/** Active router, or a lazily created fallback for out-of-context callers. */
export function currentDiscoveryRouter(): DiscoveryRouter {
  const existing = routerStore.getStore();
  if (existing) return existing;
  return new DiscoveryRouter();
}
