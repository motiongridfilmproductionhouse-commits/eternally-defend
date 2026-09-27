/**
 * Search provider policy (owner decision, 27 Sep 2026): every search-based
 * discovery — deepfake, pre-enrollment, assessments — uses Firecrawl only.
 * Brave, SerpApi, Google CSE, Gemini grounding, keyless public web, Wikipedia,
 * YouTube Data API search and Fact Check search are switched off here, so no
 * scan can silently fall back to them. Families with no Firecrawl route are
 * reported as unavailable rather than scanned.
 */
export const FIRECRAWL_ONLY_SEARCH = true;

export function nonFirecrawlSearchAllowed(): boolean {
  return !FIRECRAWL_ONLY_SEARCH;
}
