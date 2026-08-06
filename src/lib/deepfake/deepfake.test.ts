import assert from "node:assert/strict";
import test from "node:test";
import { generateDeepfakeQueries } from "./query-generator.server";
import { filterDeepfakeCandidates } from "./filter.server";
import { classifyConfidenceBand } from "./face-filter.server";
import {
  calculateDeepfakeRelevanceScore,
  determineLeadType,
  explainLeadCollection,
} from "./relevance-scorer.server";
import { parseTelemetry, type ScanTelemetry } from "../deepfake-intel.functions";
import type { Database } from "@/integrations/supabase/types";

type ScanRow = Database["public"]["Tables"]["deepfake_scans"]["Row"];

test("1. Query generator generates 20+ specialized search variations", () => {
  const queries = generateDeepfakeQueries({
    name: "Dulquer Salmaan",
    aliases: ["DQ"],
    handles: ["@dqsalmaan"],
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

test("2. Deepfake Relevance Score awards high points to synthetic & explicit media", () => {
  const hit = {
    url: "https://t.me/deepfake_channel/123",
    title: "Dulquer Salmaan AI Nude face swap edit",
    description: "Leaked explicit deepfake video",
    query: "Dulquer Salmaan AI Nude",
  };

  const result = calculateDeepfakeRelevanceScore(hit, "Dulquer Salmaan");
  assert.equal(result.score >= 800, true);
  assert.equal(result.matchedKeywords.includes("deepfake"), true);
  assert.equal(result.matchedKeywords.includes("face swap"), true);
});

test("3. Deepfake Relevance Score penalizes Wikipedia & IMDb without AI keywords", () => {
  const imdbHit = {
    url: "https://www.imdb.com/name/nm4839210/",
    title: "Dulquer Salmaan - IMDb Biography & Filmography",
    description: "Actor, producer in Indian cinema",
    query: "Dulquer Salmaan",
  };

  const result = calculateDeepfakeRelevanceScore(imdbHit, "Dulquer Salmaan");
  assert.equal(result.score < 200, true);
  assert.equal(result.isHarmless, true);
});

test("4. Lead type classification maps to exact Investigation Lead types", () => {
  assert.equal(
    determineLeadType({
      url: "https://example.com/item",
      title: "Dulquer Salmaan AI Nude Photo",
      description: "Explicit edit",
      query: "DQ explicit",
    }),
    "Explicit AI Image",
  );

  assert.equal(
    determineLeadType({
      url: "https://t.me/channel/45",
      title: "Dulquer Salmaan deepfake video",
      query: "DQ telegram",
    }),
    "Telegram Distribution",
  );
});

test("5. explainLeadCollection generates structured Why Collected metadata", () => {
  const hit = {
    url: "https://example.com/gallery",
    title: "Dulquer Salmaan deepfake face swap",
    description: "AI generated image",
    query: "Dulquer Salmaan deepfake",
  };

  const explanation = explainLeadCollection(hit, "Dulquer Salmaan", 96.4);
  assert.equal(explanation.similarity, 96.4);
  assert.equal(explanation.reason.includes("96.4%"), true);
  assert.equal(explanation.matchedQuery, "Dulquer Salmaan deepfake");
});

test("6. Confidence bands map correctly to lead states", () => {
  assert.deepEqual(classifyConfidenceBand(98), {
    band: "verified",
    label: "Verified Deepfake",
  });
  assert.deepEqual(classifyConfidenceBand(90), {
    band: "probable",
    label: "Probable Deepfake",
  });
  assert.deepEqual(classifyConfidenceBand(78), {
    band: "needs_review",
    label: "Needs Human Review",
  });
  assert.deepEqual(classifyConfidenceBand(65), {
    band: "rejected",
    label: "Rejected (Different Person)",
  });
});

test("7. parseTelemetry extracts all metrics including Candidates Found & Remaining Time", () => {
  const mockTelemetry: ScanTelemetry = {
    stage: "face_matching",
    current_provider: "google_images",
    current_query: "Dulquer Salmaan deepfake",
    current_url: "https://example.com/item",
    queries_generated: 56,
    queries_executed: 28,
    providers_used: ["google_images", "firecrawl", "brave_search"],
    candidates_found: 42,
    pages_crawled: 30,
    images_downloaded: 25,
    images_compared: 20,
    verified_matches: 8,
    probable_matches: 5,
    rejected_matches: 7,
    coverage_pct: 50,
    last_heartbeat: "2026-08-06T12:00:00Z",
    estimated_remaining_time: "24s remaining",
    stage_logs: ["✓ Identity loaded", "✓ 56 queries generated", "✓ Google Images searched"],
  };

  const mockScanRow: Partial<ScanRow> = {
    error_message: JSON.stringify(mockTelemetry),
  };

  const parsed = parseTelemetry(mockScanRow as ScanRow);
  assert.equal(parsed?.stage, "face_matching");
  assert.equal(parsed?.candidates_found, 42);
  assert.equal(parsed?.verified_matches, 8);
  assert.equal(parsed?.probable_matches, 5);
  assert.equal(parsed?.estimated_remaining_time, "24s remaining");
});
