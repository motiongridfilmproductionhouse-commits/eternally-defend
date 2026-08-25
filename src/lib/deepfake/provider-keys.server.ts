/**
 * Server-only: canonical resolution of external discovery provider keys.
 *
 * The SerpApi key has historically been stored in this project under several
 * secret names (`SERPAPI_API_KEY`, `SERP_API_KEY`, `SERP_API`, `serp_api`).
 * Reading only one name silently disables the SerpApi discovery path, which
 * makes deepfake scans complete with zero results instead of surfacing an
 * outage. Always resolve through these helpers.
 */

function firstNonEmpty(...values: Array<string | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

export function serpApiKey(): string | null {
  return firstNonEmpty(
    process.env.SERPAPI_API_KEY,
    process.env.SERP_API_KEY,
    process.env.SERP_API,
    process.env["serp_api"],
  );
}

export function braveApiKey(): string | null {
  return firstNonEmpty(process.env.BRAVE_API_KEY, process.env["brave_api_key"]);
}

export function crawlerServiceUrl(): string | null {
  const raw = firstNonEmpty(process.env.CRAWLER_SERVICE_URL, process.env.CRAWL4AI_SERVICE_URL);
  return raw ? raw.replace(/\/$/, "") : null;
}
