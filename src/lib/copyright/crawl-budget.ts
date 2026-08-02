/**
 * Crawl budget helpers: known URLs always receive reserved slots and time
 * before provider candidates can exhaust the page cap or deadline.
 */

import { MAX_KNOWN_URLS } from "./known-urls.server";
import { canonicalUrl } from "./url.server";

export const DEFAULT_PAGE_CAP = 32;
/** Wall-clock budget reserved exclusively for accepted known URLs. */
export const KNOWN_URL_BUDGET_MS = 90_000;
/** Remaining wall-clock budget for provider candidate crawls. */
export const PROVIDER_CRAWL_BUDGET_MS = 120_000;
/** Reserved wall-clock budget for title-detail follow phase. */
export const DETAIL_FOLLOW_BUDGET_MS = 45_000;
/** Reserved wall-clock budget for browser-render fallbacks across the scan. */
export const BROWSER_FALLBACK_BUDGET_MS = 60_000;
/** Reserved wall-clock budget for known/historical source rechecks. */
export const KNOWN_SOURCE_RECHECK_BUDGET_MS = 45_000;
/** Maximum wall-clock time spent rendering a single page. */
export const PER_PAGE_BROWSER_BUDGET_MS = 28_000;
/** Absolute wall-clock ceiling for one copyright scan executor run. */
export const SCAN_TOTAL_BUDGET_MS = KNOWN_URL_BUDGET_MS + PROVIDER_CRAWL_BUDGET_MS;

export function absoluteScanDeadlineAt(scanStartedAt: number): number {
  return scanStartedAt + SCAN_TOTAL_BUDGET_MS;
}

/** Known-URL early/phase budget capped by the absolute scan deadline. */
export function knownUrlDeadlineAt(scanStartedAt: number, scanDeadlineAt: number): number {
  return Math.min(scanStartedAt + KNOWN_URL_BUDGET_MS, scanDeadlineAt);
}

/** Discovery provider budget capped by the absolute scan deadline. */
export function discoveryPhaseDeadlineAt(scanStartedAt: number, scanDeadlineAt: number): number {
  return Math.min(scanStartedAt + PROVIDER_CRAWL_BUDGET_MS, scanDeadlineAt);
}

/** Provider crawl phase ends before the reserved detail-follow window. */
export function providerCrawlDeadlineAt(scanDeadlineAt: number): number {
  return scanDeadlineAt - DETAIL_FOLLOW_BUDGET_MS;
}

export interface CrawlSlotAllocation {
  knownSlots: number;
  providerSlots: number;
  totalSlots: number;
}

/**
 * Reserve one crawl slot per accepted known URL (bounded by MAX_KNOWN_URLS).
 * Provider candidates only fill remaining capacity under the page cap.
 */
export function allocateCrawlSlots(
  knownCount: number,
  providerCount: number,
  pageCap = DEFAULT_PAGE_CAP,
): CrawlSlotAllocation {
  const knownSlots = Math.min(Math.max(0, knownCount), MAX_KNOWN_URLS);
  // Known URLs always fit even if they push slightly over a tiny pageCap.
  const effectiveCap = Math.max(pageCap, knownSlots);
  const providerSlots = Math.min(
    Math.max(0, providerCount),
    Math.max(0, effectiveCap - knownSlots),
  );
  return {
    knownSlots,
    providerSlots,
    totalSlots: knownSlots + providerSlots,
  };
}

/**
 * Merge known-URL seeds ahead of provider candidates with reserved capacity.
 * All accepted known URLs are included before any provider URL, even when
 * provider candidates exceed the page cap.
 */
export function prioritizeKnownUrlLeadsWithReservation<T extends { url: string }>(
  known: T[],
  provider: T[],
  pageCap = DEFAULT_PAGE_CAP,
): T[] {
  const allocation = allocateCrawlSlots(known.length, provider.length, pageCap);
  const leadSeen = new Set<string>();
  const out: T[] = [];

  for (const lead of known.slice(0, allocation.knownSlots)) {
    const key = canonicalUrl(lead.url);
    if (leadSeen.has(key)) continue;
    leadSeen.add(key);
    out.push({ ...lead, url: key });
  }

  let providerAdded = 0;
  for (const lead of provider) {
    if (providerAdded >= allocation.providerSlots) break;
    const key = canonicalUrl(lead.url);
    if (leadSeen.has(key)) continue;
    leadSeen.add(key);
    out.push({ ...lead, url: key });
    providerAdded += 1;
  }

  return out;
}

/** Split ordered leads into known-first and provider-rest phases. */
export function splitKnownAndProviderLeads<T extends { url: string; query?: string | null }>(
  leads: T[],
): { known: T[]; provider: T[] } {
  const known: T[] = [];
  const provider: T[] = [];
  for (const lead of leads) {
    if (lead.query === "known_url_seed") known.push(lead);
    else provider.push(lead);
  }
  return { known, provider };
}

export function remainingMs(deadlineAt: number, now = Date.now()): number {
  return Math.max(0, deadlineAt - now);
}

export function isPastDeadline(deadlineAt: number, now = Date.now()): boolean {
  return now >= deadlineAt;
}
