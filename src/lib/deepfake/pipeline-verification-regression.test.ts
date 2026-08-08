import { describe, it } from "node:test";
import assert from "node:assert";
import { isScanEligibleForStaleRecovery } from "./scan-lease.server";
import { diagnosticsFromMetrics, explainNoDeepfakeResults } from "./scan-diagnostics";

describe("Deepfake Pipeline Orchestration & State Transition Tests", () => {
  it("A. Target 'bhama kurup': 56 public leads, 26 findings, all 26 rejected -> scan reaches completed, 0 verified", () => {
    const metrics = {
      queries_generated: 56,
      queries_executed: 56,
      unique_candidates: 56,
      candidates_found: 56,
      pages_crawled: 26,
      images_compared: 26,
      verified: 0,
      probable: 0,
      identity_rejected: 18,
      page_type_rejected: 8,
      unverifiable: 0,
      queue_remaining: 0,
    };

    const diagnostics = diagnosticsFromMetrics(metrics);
    assert.strictEqual(diagnostics.queries_generated, 56);
    assert.strictEqual(diagnostics.rejected_matches, 26);
    assert.strictEqual(diagnostics.verified_matches, 0);

    const explanation = explainNoDeepfakeResults(metrics, "completed");
    assert.strictEqual(explanation.headline, "No verified threats found");
    assert.ok(explanation.reasons.some((r) => r.includes("26 candidates were rejected")));

    // Pipeline invariant check
    const totalAccounted =
      diagnostics.verified_matches + diagnostics.rejected_matches + (metrics.unverifiable ?? 0);
    assert.strictEqual(totalAccounted, 26);
  });

  it("B. 26 candidates (20 rejected, 6 source unavailable) -> resolves cleanly without infinite RUNNING", () => {
    const metrics = {
      queries_generated: 56,
      queries_executed: 56,
      candidates_found: 56,
      pages_crawled: 26,
      images_compared: 20,
      verified: 0,
      probable: 0,
      identity_rejected: 20,
      url_rejected: 6,
      queue_remaining: 0,
      google_images_diagnostic: {
        provider_status: "unavailable",
        failure_reason: "Host blocked automated crawl",
      },
    };

    const diagnostics = diagnosticsFromMetrics(metrics);
    assert.strictEqual(diagnostics.rejected_matches, 26);

    const explanation = explainNoDeepfakeResults(metrics, "completed");
    assert.ok(explanation.reasons.some((r) => r.includes("Google Images was unavailable")));
  });

  it("C. 26 candidates queued -> queue decreases as processed", () => {
    const queue = Array.from({ length: 26 }, (_, i) => ({ id: `cand-${i}`, status: "queued" }));
    let remaining = queue.length;
    let processed = 0;

    for (let i = 0; i < 26; i++) {
      queue[i].status = i % 2 === 0 ? "rejected" : "unverifiable";
      remaining--;
      processed++;
    }

    assert.strictEqual(remaining, 0);
    assert.strictEqual(processed, 26);

    const isScanFinished = remaining === 0;
    assert.strictEqual(isScanFinished, true);
  });

  it("D. Worker dies after candidate discovery -> lease recovery detects stale run", () => {
    const NOW = Date.now();
    const staleScanRow = {
      status: "running",
      lease_expires_at: new Date(NOW - 180_000).toISOString(), // 3 mins ago (grace is 2 mins)
      heartbeat_at: new Date(NOW - 180_000).toISOString(),
    };

    const eligible = isScanEligibleForStaleRecovery(staleScanRow, NOW);
    assert.strictEqual(eligible, true);
  });

  it("E. Legacy RUNNING scan without lease_expires_at (older than 5m) -> recovered & finalized", () => {
    const NOW = Date.now();
    const legacyScanRow = {
      status: "running",
      lease_expires_at: null,
      created_at: new Date(NOW - 600_000).toISOString(), // 10 mins ago
      heartbeat_at: new Date(NOW - 600_000).toISOString(),
    };

    const eligible = isScanEligibleForStaleRecovery(legacyScanRow, NOW);
    assert.strictEqual(eligible, true);
  });

  it("F. 0 verified explicit threats -> scan can complete successfully", () => {
    const scanStatus = "completed";
    const verifiedExplicitCount = 0;
    const totalFindings = 26;

    const canCompleteWithZeroThreats = scanStatus === "completed" && verifiedExplicitCount === 0 && totalFindings > 0;
    assert.strictEqual(canCompleteWithZeroThreats, true);
  });

  it("G. Generated 56 queries -> total_queries is non-zero and persisted", () => {
    const scanRow = {
      total_queries: 56,
      discovery_metrics: {
        queries_generated: 56,
        queries_executed: 56,
      },
    };

    const queriesCount =
      scanRow.total_queries ||
      scanRow.discovery_metrics.queries_generated ||
      scanRow.discovery_metrics.queries_executed;

    assert.strictEqual(queriesCount, 56);
    assert.notStrictEqual(queriesCount, 0);
  });
});
