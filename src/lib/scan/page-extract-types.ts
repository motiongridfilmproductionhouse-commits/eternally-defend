/** Client-safe extraction telemetry shape (mirrors page-extract.server.ts). */
export interface ExtractionStats {
  CRAWL4AI_CONFIGURED: boolean;
  CRAWL4AI_ATTEMPTED: number;
  CRAWL4AI_SUCCESS: number;
  CRAWL4AI_FAILED: number;
  FETCH_FALLBACK_USED: number;
  FETCH_SUCCESS: number;
  FETCH_FAILED: number;
  crawl4ai_config_hint?: string;
  crawl4ai_failure_samples: string[];
}
