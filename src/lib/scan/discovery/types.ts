/**
 * Web Scan — provider-agnostic discovery contracts (client-safe types).
 *
 * Discovery is never allowed to depend on a single provider: the router keeps
 * per-provider health and continues with any remaining healthy provider.
 */

export type ProviderId = "firecrawl" | "serpapi" | "brave";

export type ProviderState =
  | "HEALTHY"
  | "NOT_CONFIGURED"
  | "CREDITS_EXHAUSTED"
  | "RATE_LIMITED"
  | "AUTH_FAILED"
  | "TIMEOUT"
  | "UNAVAILABLE";

export type ProviderFailureKind =
  | "credits_exhausted"
  | "rate_limited"
  | "auth_failed"
  | "timeout"
  | "unavailable"
  | "bad_response";

export interface DiscoveryHit {
  url?: string;
  title?: string;
  description?: string;
  snippet?: string;
  author?: string;
  date?: string;
  publishedDate?: string;
  media?: { thumbnail?: string; thumbnailHi?: string };
  queryUsed?: string;
  /** Which discovery provider surfaced this URL first. */
  provider?: ProviderId;
  [key: string]: unknown;
}

export interface ProviderHealthReport {
  provider: ProviderId;
  configured: boolean;
  healthy: boolean;
  state: ProviderState;
  queriesAttempted: number;
  queriesSuccessful: number;
  queriesFailed: number;
  urlsReturned: number;
  rateLimited: boolean;
  creditsExhausted: boolean;
  latencyMsTotal: number;
  latencyMsAvg: number;
  failureReason?: string;
}

export interface DiscoveryQueryStats {
  /** Normalized queries actually dispatched to at least one provider. */
  executed: string[];
  /** Normalized queries skipped because an identical query already ran. */
  duplicatesPrevented: number;
  /** Queries where every configured provider failed. */
  failed: number;
}

export interface DiscoveryRouterReport {
  providers: ProviderHealthReport[];
  queries: {
    attempted: number;
    executed: number;
    duplicatesPrevented: number;
    failed: number;
  };
  urls_returned: number;
  urls_unique: number;
  duplicates_removed: number;
  all_providers_down: boolean;
}
