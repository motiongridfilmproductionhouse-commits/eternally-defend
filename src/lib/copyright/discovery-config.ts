/**
 * Copyright Intelligence discovery targets and safety caps.
 *
 * TARGET applies to unique discovery candidate URLs — a goal, not a success
 * condition. Scans must not stop early when N verified threats are found.
 */

/** Comfortable discovery target before the safety cap (not a minimum requirement). */
export const TARGET_DISCOVERY_CANDIDATES = 30;
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

/** Minimum search queries generated when all adaptive stages are expanded. */
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

/** At 60% of scan deadline, trigger second-stage query expansion if below TARGET. */
export const DISCOVERY_FALLBACK_DEADLINE_FRACTION = 0.6;

/** Unique candidates at which discovery shifts from coverage to saturation mode. */
export const SATURATION_DISCOVERY_CANDIDATES = 60;

/** Minimum distinct hostnames before 30 candidates count as broad coverage. */
export const MIN_UNIQUE_DOMAINS_FOR_BROAD_COVERAGE = 4;
/** Minimum platform categories before stage 2/3 expansion can be skipped at target. */
export const MIN_PLATFORM_CATEGORIES_FOR_BROAD_COVERAGE = 3;

/** Legacy alias — prefer hasBroadDiscoveryCoverage() for stage gating. */
export const STAGE_ADEQUATE_COVERAGE_CANDIDATES = TARGET_DISCOVERY_CANDIDATES;

/** Re-export crawl phase budgets derived from MAX_SCAN_TIME_MS. */
export const KNOWN_URL_BUDGET_MS = Math.floor(MAX_SCAN_TIME_MS * 0.2);
export const PROVIDER_CRAWL_BUDGET_MS = Math.floor(MAX_SCAN_TIME_MS * 0.55);
export const DETAIL_FOLLOW_BUDGET_MS =
  MAX_SCAN_TIME_MS - KNOWN_URL_BUDGET_MS - PROVIDER_CRAWL_BUDGET_MS;

/** Explicit per-provider time budgets within the provider crawl phase. */
export const FIRECRAWL_PROVIDER_BUDGET_MS = Math.floor(PROVIDER_CRAWL_BUDGET_MS * 0.55);
export const SERPAPI_PROVIDER_BUDGET_MS = Math.floor(PROVIDER_CRAWL_BUDGET_MS * 0.25);
export const BRIGHTDATA_PROVIDER_BUDGET_MS = Math.floor(PROVIDER_CRAWL_BUDGET_MS * 0.2);

export const SCAN_TOTAL_BUDGET_MS = MAX_SCAN_TIME_MS;
export const DEFAULT_PAGE_CAP = MAX_CRAWL_PAGES;
