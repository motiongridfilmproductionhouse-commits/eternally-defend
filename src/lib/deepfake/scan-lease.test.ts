import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTINUATION_SCHEDULED_GRACE_MS,
  STALE_RECOVERY_GRACE_MS,
  WORKER_LEASE_TTL_MS,
  isScanEligibleForStaleRecovery,
  staleRecoveryLeaseCutoffIso,
} from "./scan-lease.server";

const NOW = Date.parse("2026-08-03T12:00:00.000Z");

test("worker lease TTL exceeds single worker budget", () => {
  assert.ok(WORKER_LEASE_TTL_MS > 35_000 * 2);
});

test("stale recovery waits for grace period after lease expiry", () => {
  const row = {
    status: "running",
    lease_expires_at: new Date(NOW - 30_000).toISOString(),
    heartbeat_at: new Date(NOW - 30_000).toISOString(),
  };
  assert.equal(isScanEligibleForStaleRecovery(row, NOW), false);
});

test("stale recovery skips scans with recent continuation handoff", () => {
  const row = {
    status: "running",
    lease_expires_at: new Date(NOW - STALE_RECOVERY_GRACE_MS - 5_000).toISOString(),
    heartbeat_at: new Date(NOW - STALE_RECOVERY_GRACE_MS - 5_000).toISOString(),
    discovery_metrics: {
      continuation_scheduled_at: new Date(
        NOW - CONTINUATION_SCHEDULED_GRACE_MS + 10_000,
      ).toISOString(),
    },
  };
  assert.equal(isScanEligibleForStaleRecovery(row, NOW), false);
});

test("stale recovery skips scans with recent worker batch progress", () => {
  const row = {
    status: "running",
    lease_expires_at: new Date(NOW - STALE_RECOVERY_GRACE_MS - 5_000).toISOString(),
    heartbeat_at: new Date(NOW - STALE_RECOVERY_GRACE_MS - 5_000).toISOString(),
    discovery_metrics: {
      worker_last_batch_at: new Date(NOW - 30_000).toISOString(),
    },
  };
  assert.equal(isScanEligibleForStaleRecovery(row, NOW), false);
});

test("stale recovery marks only truly abandoned scans", () => {
  const row = {
    status: "running",
    lease_expires_at: new Date(NOW - STALE_RECOVERY_GRACE_MS - 5_000).toISOString(),
    heartbeat_at: new Date(NOW - STALE_RECOVERY_GRACE_MS - 5_000).toISOString(),
    discovery_metrics: {
      continuation_scheduled_at: new Date(
        NOW - CONTINUATION_SCHEDULED_GRACE_MS - 60_000,
      ).toISOString(),
    },
  };
  assert.equal(isScanEligibleForStaleRecovery(row, NOW), true);
});

test("stale recovery lease cutoff subtracts grace window", () => {
  assert.equal(
    staleRecoveryLeaseCutoffIso(NOW),
    new Date(NOW - STALE_RECOVERY_GRACE_MS).toISOString(),
  );
});
