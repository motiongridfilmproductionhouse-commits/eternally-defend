/**
 * Canonical crawl telemetry for Copyright Intelligence scans.
 * Separated from discovery provider metrics.
 */

export interface CrawlMetrics {
  static_fetch_succeeded: number;
  static_fetch_empty: number;
  browser_fallback_attempted: number;
  browser_fallback_succeeded: number;
  browser_fallback_failed: number;
  crawl4ai_fallback_attempted: number;
  crawl4ai_fallback_succeeded: number;
  detail_pages_followed: number;
  pages_rendered: number;
  pages_rejected_by_title: number;
  pages_rejected_as_official_or_promo: number;
  pages_missing_access_evidence: number;
  findings_created: number;
  exact_title_pages_found: number;
  pages_with_access_evidence: number;
}

export function emptyCrawlMetrics(): CrawlMetrics {
  return {
    static_fetch_succeeded: 0,
    static_fetch_empty: 0,
    browser_fallback_attempted: 0,
    browser_fallback_succeeded: 0,
    browser_fallback_failed: 0,
    crawl4ai_fallback_attempted: 0,
    crawl4ai_fallback_succeeded: 0,
    detail_pages_followed: 0,
    pages_rendered: 0,
    pages_rejected_by_title: 0,
    pages_rejected_as_official_or_promo: 0,
    pages_missing_access_evidence: 0,
    findings_created: 0,
    exact_title_pages_found: 0,
    pages_with_access_evidence: 0,
  };
}

export class CrawlMetricsRecorder {
  private metrics = emptyCrawlMetrics();

  mergeToStats(stats: Record<string, unknown>): Record<string, unknown> {
    return { ...stats, crawl_metrics: { ...this.metrics } };
  }

  get(): CrawlMetrics {
    return { ...this.metrics };
  }

  recordStaticSuccess(): void {
    this.metrics.static_fetch_succeeded += 1;
  }

  recordStaticEmpty(): void {
    this.metrics.static_fetch_empty += 1;
  }

  recordBrowserAttempt(): void {
    this.metrics.browser_fallback_attempted += 1;
  }

  recordBrowserSuccess(): void {
    this.metrics.browser_fallback_succeeded += 1;
    this.metrics.pages_rendered += 1;
  }

  recordBrowserFailure(): void {
    this.metrics.browser_fallback_failed += 1;
  }

  recordCrawl4AiAttempt(): void {
    this.metrics.crawl4ai_fallback_attempted += 1;
  }

  recordCrawl4AiSuccess(): void {
    this.metrics.crawl4ai_fallback_succeeded += 1;
    this.metrics.pages_rendered += 1;
  }

  recordDetailFollow(): void {
    this.metrics.detail_pages_followed += 1;
  }

  recordExactTitle(): void {
    this.metrics.exact_title_pages_found += 1;
  }

  recordAccessEvidence(): void {
    this.metrics.pages_with_access_evidence += 1;
  }

  recordFinding(): void {
    this.metrics.findings_created += 1;
  }

  recordTitleRejected(): void {
    this.metrics.pages_rejected_by_title += 1;
  }

  recordOfficialOrPromoRejected(): void {
    this.metrics.pages_rejected_as_official_or_promo += 1;
  }

  recordMissingAccessEvidence(): void {
    this.metrics.pages_missing_access_evidence += 1;
  }
}
