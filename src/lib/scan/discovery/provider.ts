/**
 * Web Scan — discovery provider adapter contract + shared failure classifier.
 */

import type { DiscoveryHit, ProviderFailureKind, ProviderId } from "./types";

export class ProviderError extends Error {
  kind: ProviderFailureKind;
  status?: number;

  constructor(kind: ProviderFailureKind, message: string, status?: number) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
    this.status = status;
  }
}

export interface SearchProviderAdapter {
  id: ProviderId;
  /** Human label used in diagnostics. */
  label: string;
  isConfigured(): boolean;
  /** Throws ProviderError on failure; returns hits (possibly empty) on success. */
  search(query: string, limit: number, signal?: AbortSignal): Promise<DiscoveryHit[]>;
}

/** Map an HTTP status + body into a provider failure kind. */
export function classifyHttpFailure(status: number, body = ""): ProviderFailureKind {
  const text = body.toLowerCase();
  if (status === 402 || /insufficient credit|out of credits|payment required|quota exceeded/.test(text)) {
    return "credits_exhausted";
  }
  if (status === 429 || /rate limit|too many requests/.test(text)) return "rate_limited";
  if (status === 401 || status === 403) return "auth_failed";
  if (status === 408 || status === 504) return "timeout";
  if (status >= 500) return "unavailable";
  return "bad_response";
}

/** Map a thrown transport error into a provider failure kind. */
export function classifyThrownFailure(error: unknown): ProviderFailureKind {
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (/abort|timeout|timed out|etimedout/.test(msg)) return "timeout";
  if (/insufficient credit|out of credits|402/.test(msg)) return "credits_exhausted";
  if (/rate limit|429/.test(msg)) return "rate_limited";
  if (/unauthor|forbidden|invalid api key|401|403/.test(msg)) return "auth_failed";
  return "unavailable";
}

export async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ status: number; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    return { status: res.status, text };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
