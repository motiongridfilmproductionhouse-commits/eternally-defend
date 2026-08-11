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
  /** Warm-browser latency telemetry from the crawler service. */
  crawl4ai_avg_ms?: number;
  crawl4ai_total_ms?: number;
  crawl4ai_circuit_open_skips?: number;
}

