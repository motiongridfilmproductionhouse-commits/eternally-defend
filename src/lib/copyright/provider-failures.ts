/**
 * Provider failure categories for Copyright Intelligence discovery.
 * Never log or expose API key / secret values.
 */

export const PROVIDER_FAILURE_CATEGORIES = [
  "missing_api_key",
  "authentication_failed",
  "invalid_credentials",
  "insufficient_credits",
  "rate_limited",
  "timeout",
  "provider_unavailable",
  "malformed_response",
  "invalid_response",
  "no_results",
  "executor_not_started",
] as const;

export type ProviderFailureCategory = (typeof PROVIDER_FAILURE_CATEGORIES)[number];

export function emptyProviderFailureCounts(): Record<ProviderFailureCategory, number> {
  return Object.fromEntries(
    PROVIDER_FAILURE_CATEGORIES.map((c) => [c, 0]),
  ) as Record<ProviderFailureCategory, number>;
}

export function bumpProviderFailure(
  counts: Record<string, number>,
  category: ProviderFailureCategory | null | undefined,
): void {
  if (!category) return;
  counts[category] = (counts[category] ?? 0) + 1;
}

/** Classify Firecrawl/search HTTP or thrown errors into safe categories. */
export function classifyProviderFailure(opts: {
  status?: number | null;
  error?: unknown;
  configured?: boolean;
}): ProviderFailureCategory {
  if (opts.configured === false) return "missing_api_key";

  const status = opts.status ?? 0;
  if (status === 401 || status === 403) return "authentication_failed";
  if (status === 429) return "rate_limited";
  if (status === 408 || status === 504) return "timeout";
  if (status >= 500 && status <= 599) return "provider_unavailable";
  if (status > 0 && status !== 200) return "provider_unavailable";

  const msg =
    opts.error instanceof Error
      ? `${opts.error.name} ${opts.error.message}`
      : typeof opts.error === "string"
        ? opts.error
        : "";
  const lower = msg.toLowerCase();

  if (/missing|not configured|api[_ ]?key/i.test(lower)) return "missing_api_key";
  if (/401|403|unauthorized|forbidden|auth/i.test(lower)) return "authentication_failed";
  if (/429|rate.?limit/i.test(lower)) return "rate_limited";
  if (/timeout|timed out|etimedout|abort/i.test(lower)) return "timeout";
  if (/json|parse|malformed|unexpected token/i.test(lower)) return "malformed_response";
  if (/econnrefused|enotfound|unavailable|502|503|504/i.test(lower)) {
    return "provider_unavailable";
  }
  return "provider_unavailable";
}

/** Sanitize failure detail — never include secrets. */
export function sanitizeProviderFailureDetail(value: unknown, maxLen = 200): string {
  const raw =
    value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : "Provider request failed";
  return raw
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/fc-[A-Za-z0-9_-]+/g, "[redacted-key]")
    .replace(/lovc_[A-Za-z0-9_-]+/g, "[redacted-key]")
    .replace(/api[_-]?key["']?\s*[:=]\s*["']?[^"'\s]+/gi, "api_key=[redacted]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}
