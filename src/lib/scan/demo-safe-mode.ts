/**
 * TEMPORARY — DEMO_SAFE_MODE (Web Scan only).
 *
 * Caps the expensive volume knobs of the Web Scan pipeline so a full scan
 * finishes inside the hosted request budget (target < 3–4 min) instead of
 * dying at the gateway with a plain-text "Internal server error".
 *
 * What is NOT touched: Brave/discovery routing, OpenAI Research pass 1,
 * YouTube discovery itself, entity verification, risk classification, and
 * ranking. Only workload volume, extraction budget, AI pass-2 gating and
 * response payload size are limited.
 *
 * Remove this module when the durable async scan-job architecture lands.
 */

export const DEMO_SAFE_MODE_ENABLED =
  (process.env["DEMO_SAFE_MODE"] ?? "true").toLowerCase() !== "false";

export const DEMO_SAFE_CAPS = {
  /** YouTube target results per scan (normally up to 2000). */
  youtubeTarget: 400,
  /** Firecrawl/router results per query (normally up to 10). */
  perQueryLimit: 6,
  /** Page-extraction budget. */
  extraction: { max: 60, concurrency: 8, timeoutMs: 8_000 },
  /** Extraction budget for AI-research URLs only. */
  aiExtraction: { max: 24, concurrency: 8, timeoutMs: 8_000 },
  /** OpenAI research pass-1 query ceiling (normally 30). */
  aiPass1Ceiling: 16,
  /** Findings returned in the first page of the response. */
  responsePageSize: 220,
} as const;

/** Pass 2 only runs in demo mode when pass 1 coverage is genuinely weak. */
export function demoAllowsSecondPass(input: {
  coverageAssessment: string;
  newUrlsFromPass1: number;
  uniqueDomains: number;
}): boolean {
  if (!DEMO_SAFE_MODE_ENABLED) return true;
  return (
    input.coverageAssessment === "SPARSE" ||
    input.newUrlsFromPass1 < 5 ||
    input.uniqueDomains < 8
  );
}

export function demoCap<T>(value: T, capped: T): T {
  return DEMO_SAFE_MODE_ENABLED ? capped : value;
}
