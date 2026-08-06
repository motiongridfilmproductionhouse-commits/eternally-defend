import assert from "node:assert/strict";
import test from "node:test";
import { generateDeepfakeQueries } from "./query-generator.server";
import { parseTelemetry, type ScanTelemetry } from "../deepfake-intel.functions";
import type { Database } from "@/integrations/supabase/types";

type ScanRow = Database["public"]["Tables"]["deepfake_scans"]["Row"];

test("1. Query generator generates 20+ specialized search variations", () => {
  const queries = generateDeepfakeQueries({
    name: "John Doe",
    aliases: ["JD"],
    handles: ["@johndoe"],
  });

  assert.equal(queries.length >= 20, true);
  assert.equal(
    queries.some((q) => q.includes("deepfake")),
    true,
  );
  assert.equal(
    queries.some((q) => q.includes("face swap")),
    true,
  );
  assert.equal(
    queries.some((q) => q.includes("ai generated")),
    true,
  );
  assert.equal(
    queries.some((q) => q.includes("site:reddit.com")),
    true,
  );
  assert.equal(
    queries.some((q) => q.includes("site:t.me")),
    true,
  );
  assert.equal(
    queries.some((q) => q.includes("site:terabox.com")),
    true,
  );
});

test("2. parseTelemetry correctly extracts heartbeat metrics from scan error_message", () => {
  const mockTelemetry: ScanTelemetry = {
    stage: "crawling_pages",
    current_provider: "firecrawl",
    current_query: "John Doe deepfake",
    current_url: "https://example.com/item",
    queries_generated: 56,
    queries_executed: 28,
    providers_used: ["firecrawl", "brave_search"],
    pages_crawled: 12,
    images_downloaded: 10,
    face_comparisons_completed: 8,
    deepfake_candidates: 12,
    verified_findings: 5,
    rejected_findings: 7,
    coverage_pct: 50,
    last_heartbeat: "2026-08-06T12:00:00Z",
    stage_logs: ["✓ Identity profile loaded", "✓ 56 queries generated", "✓ Google Images complete"],
  };

  const mockScanRow: Partial<ScanRow> = {
    error_message: JSON.stringify(mockTelemetry),
  };

  const parsed = parseTelemetry(mockScanRow as ScanRow);
  assert.equal(parsed?.stage, "crawling_pages");
  assert.equal(parsed?.queries_executed, 28);
  assert.equal(parsed?.providers_used.length, 2);
  assert.equal(parsed?.coverage_pct, 50);
});

test("3. parseTelemetry returns null for plain string errors", () => {
  const mockScanRow: Partial<ScanRow> = {
    error_message: "FAILED DURING GOOGLE IMAGES: Rate limit exceeded",
  };

  const parsed = parseTelemetry(mockScanRow as ScanRow);
  assert.equal(parsed, null);
});

test("4. Query generator handles empty handles/aliases gracefully", () => {
  const queries = generateDeepfakeQueries({
    name: "Jane Smith",
  });

  assert.equal(queries.length >= 10, true);
  assert.equal(
    queries.every((q) => typeof q === "string" && q.trim().length > 0),
    true,
  );
});
