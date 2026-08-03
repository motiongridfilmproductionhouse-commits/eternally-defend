/**
 * Copyright Intelligence discovery targets and safety caps.
 *
 * MIN/TARGET apply to unique discovery candidate URLs — never to verified
 * infringement findings. Scans must not stop early when N threats are found.
 */

/** Minimum unique candidate URLs to aim for when public results exist. */
export const MIN_DISCOVERY_CANDIDATES = 30;
/** Comfortable discovery target before the safety cap. */
export const TARGET_DISCOVERY_CANDIDATES = 60;
/** Hard ceiling on unique discovery candidate URLs per scan. */
export const MAX_DISCOVERY_CANDIDATES = 200;
/** Maximum distinct hostnames in the candidate union. */
export const MAX_UNIQUE_DOMAINS = 100;

/** Absolute wall-clock ceiling for one copyright scan executor run. */
export const MAX_SCAN_TIME_MS = 240_000;

/** Max pages inspected per scan (known URLs + provider candidates). */
export const MAX_CRAWL_PAGES = 160;
/** Detail-follow queue capacity. */
export const MAX_DETAIL_QUEUE = 120;
/** Per-drain batch during recursive detail follow. */
export const MAX_DETAIL_DRAIN = 80;
/** Max outbound hop depth from a seed listing. */
export const MAX_DEPTH = 2;
/** Max candidate pages retained per hostname (distinct URLs still allowed). */
export const MAX_PAGES_PER_DOMAIN = 8;

/** Minimum search queries generated per scan. */
export const MIN_DISCOVERY_QUERIES = 40;
/** Upper bound on queries sent to Firecrawl per scan. */
export const MAX_DISCOVERY_QUERIES_PER_SCAN = 72;

/** Firecrawl results per search request (pagination via extra pages when needed). */
export const FIRECRAWL_SEARCH_LIMIT = 25;
/** Extra result pages for high-priority exact-title / site queries. */
export const FIRECRAWL_PRIORITY_QUERY_PAGES = 2;

/** SerpApi HTTP attempts per scan when configured. */
export const SERPAPI_MAX_HTTP_ATTEMPTS = 12;
/** Bright Data SERP queries per scan when configured. */
export const BRIGHTDATA_MAX_QUERIES_PER_SCAN = 20;

/** At 60% of scan deadline, trigger second-stage query expansion if below MIN. */
export const DISCOVERY_FALLBACK_DEADLINE_FRACTION = 0.6;

/** Re-export crawl phase budgets derived from MAX_SCAN_TIME_MS. */
export const KNOWN_URL_BUDGET_MS = Math.floor(MAX_SCAN_TIME_MS * 0.2);
export const PROVIDER_CRAWL_BUDGET_MS = Math.floor(MAX_SCAN_TIME_MS * 0.55);
export const DETAIL_FOLLOW_BUDGET_MS =
  MAX_SCAN_TIME_MS - KNOWN_URL_BUDGET_MS - PROVIDER_CRAWL_BUDGET_MS;

export const SCAN_TOTAL_BUDGET_MS = MAX_SCAN_TIME_MS;
export const DEFAULT_PAGE_CAP = MAX_CRAWL_PAGES;
