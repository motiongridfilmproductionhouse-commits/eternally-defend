import assert from "node:assert/strict";
import test from "node:test";
import { generateDeepfakeQueries } from "./query-generator.server";
import { filterDeepfakeCandidates } from "./filter.server";
import { classifyConfidenceBand } from "./face-filter.server";
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

test("2. Lead-First Filter preserves candidate leads for verification", () => {
  const hits = [
    {
      url: "https://example.com/gallery/123",
      title: "John Doe Photo Gallery",
      description: "Pictures of John Doe",
      query: "John Doe deepfake",
      image_url: "https://example.com/img1.jpg",
    },
    {
      url: "https://pinterest.com/pin/456",
      title: "John Doe pin",
      description: "Discovered pin",
      query: "John Doe face swap",
      thumbnail_url: "https://pinterest.com/thumb.jpg",
    },
  ];

  const result = filterDeepfakeCandidates(hits, { name: "John Doe" });
  assert.equal(result.accepted.length, 2);
});

test("3. Confidence bands map correctly to lead states", () => {
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

test("4. parseTelemetry extracts all metrics including Candidates Found & Remaining Time", () => {
  const mockTelemetry: ScanTelemetry = {
    stage: "face_matching",
    current_provider: "google_images",
    current_query: "John Doe deepfake",
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
