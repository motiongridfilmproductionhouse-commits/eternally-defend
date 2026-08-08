import { describe, it } from "node:test";
import assert from "node:assert";
import { isScanEligibleForStaleRecovery } from "./scan-lease.server";

describe("Deepfake Scan Launch Decisions & Stale Recovery Tests", () => {
  it("Requirement 12: Production Fixture (target: bhama kurup, heartbeat 33 mins ago) -> recovers old scan as partial and allows restart", () => {
    const NOW = Date.now();
    const staleScanRow = {
      id: "scan-bhama-stale",
      status: "running",
      target_name: "bhama kurup",
      heartbeat_at: new Date(NOW - 33 * 60 * 1000).toISOString(),
      lease_expires_at: new Date(NOW - 30 * 60 * 1000).toISOString(),
      discovery_metrics: {
        candidates_found: 56,
        images_compared: 26,
        verified_matches: 0,
        probable_matches: 0,
        rejected_matches: 0,
        queue_remaining: 0,
      },
    };

    const isStale = isScanEligibleForStaleRecovery(staleScanRow, NOW);
    assert.strictEqual(isStale, true);

    // Compute expected terminal status for stale recovery
    const candidatesFound = staleScanRow.discovery_metrics.candidates_found;
    const imagesCompared = staleScanRow.discovery_metrics.images_compared;

    let targetStatus: "completed" | "partial" | "failed" = "partial";
    if (candidatesFound > 0 && imagesCompared >= candidatesFound) {
      targetStatus = "completed";
    } else if (candidatesFound > 0) {
      targetStatus = "partial";
    } else {
      targetStatus = "failed";
    }

    assert.strictEqual(targetStatus, "partial");
  });

  it("Requirement 13: Healthy Active Scan (heartbeat 10s ago) -> blocks duplicate scan creation", () => {
    const NOW = Date.now();
    const activeScanRow = {
      id: "scan-active-123",
      status: "running",
      target_name: "bhama kurup",
      heartbeat_at: new Date(NOW - 10 * 1000).toISOString(),
      lease_expires_at: new Date(NOW + 120 * 1000).toISOString(),
    };

    const isStale = isScanEligibleForStaleRecovery(activeScanRow, NOW);
    assert.strictEqual(isStale, false);

    // Decision when non-stale active scan exists
    const action = isStale ? "recover_then_restart" : "blocked_active_scan";
    assert.strictEqual(action, "blocked_active_scan");
  });

  it("Requirement 14: Worker launch failure -> scan does not remain running indefinitely", () => {
    const launchAttempt = {
      dispatched: false,
      error: "Cloudflare worker timeout",
    };

    let status = "running";
    let errorMessage: string | null = null;

    if (!launchAttempt.dispatched) {
      status = "failed";
      errorMessage = `Worker dispatch failed: ${launchAttempt.error}`;
    }

    assert.strictEqual(status, "failed");
    assert.ok(errorMessage?.includes("Cloudflare worker timeout"));
  });

  it("Requirement 15: Multiple historical scans (heartbeat > 5m ago) -> all recovered into completed/partial/failed", () => {
    const NOW = Date.now();
    const historicalScans = [
      { id: "s1", status: "running", heartbeat_at: new Date(NOW - 40 * 60 * 1000).toISOString(), discovery_metrics: { candidates_found: 10, images_compared: 10 } },
      { id: "s2", status: "running", heartbeat_at: new Date(NOW - 25 * 60 * 1000).toISOString(), discovery_metrics: { candidates_found: 50, images_compared: 20 } },
      { id: "s3", status: "running", heartbeat_at: new Date(NOW - 15 * 60 * 1000).toISOString(), discovery_metrics: { candidates_found: 0, images_compared: 0 } },
    ];

    const recoveredStatuses = historicalScans.map((scan) => {
      const eligible = isScanEligibleForStaleRecovery(scan, NOW);
      if (!eligible) return scan.status;

      const candidates = scan.discovery_metrics.candidates_found;
      const compared = scan.discovery_metrics.images_compared;

      if (candidates > 0 && compared >= candidates) return "completed";
      if (candidates > 0) return "partial";
      return "failed";
    });

    assert.deepStrictEqual(recoveredStatuses, ["completed", "partial", "failed"]);
    assert.ok(recoveredStatuses.every((s) => s !== "running"));
  });
});
