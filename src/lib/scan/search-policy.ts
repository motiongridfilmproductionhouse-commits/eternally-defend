/**
 * Search provider policy (owner decision, 27 Sep 2026; amended 28 Sep 2026):
 * every search-based discovery — deepfake, pre-enrollment, assessments — uses
 * Firecrawl as the primary provider, with Brave Search (BRAVE_API_KEY) now
 * approved as a second engine to widen coverage. SerpApi, Google CSE, Gemini
 * grounding, keyless public web, Wikipedia, YouTube Data API search and Fact
 * Check search remain switched off here, so no scan can silently fall back to
 * them. Families with no Firecrawl/Brave route are reported as unavailable
 * rather than scanned.
 */
export const FIRECRAWL_ONLY_SEARCH = true;

/** Brave Search was approved by the owner on 28 Sep 2026 as a second engine. */
export const BRAVE_SEARCH_ALLOWED = true;

export function searchProviderAllowed(providerId: string): boolean {
  if (providerId.startsWith("firecrawl")) return true;
  if (providerId === "brave") return BRAVE_SEARCH_ALLOWED;
  return !FIRECRAWL_ONLY_SEARCH;
}

export function nonFirecrawlSearchAllowed(): boolean {
  return !FIRECRAWL_ONLY_SEARCH;
}
