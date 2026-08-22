import test from "node:test";
import assert from "node:assert/strict";
import {
  selectDueAssets,
  runCopyrightIntelForUser,
  type ProtectedAssetLike,
} from "./copyright.server";
import { createMockSupabase } from "../test-utils";

const NOW = new Date("2026-08-23T00:00:00.000Z");

test("selectDueAssets: a never-scanned asset is due", () => {
  const assets: ProtectedAssetLike[] = [
    { id: "a1", name: "Poster", storage_path: "clients/u/assets/a1.jpg" },
  ];
  const due = selectDueAssets(assets, new Map(), 1440, NOW);
  assert.deepEqual(
    due.map((a) => a.id),
    ["a1"],
  );
});

test("selectDueAssets: newly-added protected asset becomes a copyright target immediately", () => {
  const existing: ProtectedAssetLike[] = [{ id: "a1", name: "Old", storage_path: "p1" }];
  const lastScan = new Map([["a1", new Date(NOW.getTime() - 60_000).toISOString()]]); // scanned 1 min ago
  // Not due yet (within cadence window).
  assert.deepEqual(selectDueAssets(existing, lastScan, 1440, NOW), []);

  // A new asset is added — it's never been scanned, so it's due immediately
  // regardless of the other asset's cadence.
  const withNewAsset = [...existing, { id: "a2", name: "New", storage_path: "p2" }];
  const due = selectDueAssets(withNewAsset, lastScan, 1440, NOW);
  assert.deepEqual(
    due.map((a) => a.id),
    ["a2"],
  );
});

test("selectDueAssets: an asset scanned within the cadence window is skipped, one scanned outside it is due", () => {
  const assets: ProtectedAssetLike[] = [
    { id: "recent", name: "Recent", storage_path: "p1" },
    { id: "stale", name: "Stale", storage_path: "p2" },
  ];
  const lastScan = new Map([
    ["recent", new Date(NOW.getTime() - 5 * 60_000).toISOString()], // 5 min ago
    ["stale", new Date(NOW.getTime() - 2 * 24 * 60 * 60_000).toISOString()], // 2 days ago
  ]);
  const due = selectDueAssets(assets, lastScan, 24 * 60, NOW); // 24h cadence
  assert.deepEqual(
    due.map((a) => a.id),
    ["stale"],
  );
});

test("selectDueAssets: assets with no storage_path are never selected", () => {
  const assets: ProtectedAssetLike[] = [{ id: "a1", name: "No file", storage_path: null }];
  assert.deepEqual(selectDueAssets(assets, new Map(), 1440, NOW), []);
});

test("selectDueAssets: bounded to MAX_ASSETS_PER_TICK (5) even with many due assets", () => {
  const assets: ProtectedAssetLike[] = Array.from({ length: 12 }, (_, i) => ({
    id: `a${i}`,
    name: `Asset ${i}`,
    storage_path: `p${i}`,
  }));
  const due = selectDueAssets(assets, new Map(), 1440, NOW);
  assert.equal(due.length, 5);
});

test("runCopyrightIntelForUser: no eligible assets -> honest WAITING_FOR_NEXT_SCAN, never fake progress", async () => {
  const supabase = createMockSupabase({ protected_assets: [] });
  const outcome = await runCopyrightIntelForUser(supabase, "user-1", 1440);
  assert.equal(outcome.status, "WAITING_FOR_NEXT_SCAN");
  assert.equal(outcome.blocked_reason, "NO_ELIGIBLE_ASSETS");
});

test("runCopyrightIntelForUser: qualifying match captures evidence before case prep, in order", async () => {
  const supabase = createMockSupabase({
    protected_assets: [
      { id: "asset-1", user_id: "user-1", name: "Poster", storage_path: "p1", active: true },
    ],
  });
  const order: string[] = [];

  const outcome = await runCopyrightIntelForUser(supabase, "user-1", 1440, {
    executeCopyrightScanById: async ({ scanId }) => {
      // Simulate the pipeline discovering one confirmed match for this scan.
      supabase._store.copyright_matches = supabase._store.copyright_matches ?? [];
      supabase._store.copyright_matches.push({
        id: "match-1",
        scan_id: scanId,
        source_url: "https://pirate.example/reup",
        page_title: "Reupload",
        confidence_band: "confirmed",
        review_status: "pending",
      });
      return { status: "completed" };
    },
    captureEvidence: async (_s, input) => {
      order.push(`evidence:${input.findingId}`);
      return { ok: true, evidenceId: "ev-1", status: "verified" };
    },
    onVerifiedFinding: async (_s, _u, finding) => {
      order.push(`case:${finding.id}`);
      return { caseId: "case-1", status: "QUEUED", idempotencyDeduplicated: false };
    },
  });

  assert.equal(outcome.status, "COMPLETED");
  assert.equal(outcome.candidates_found, 1);
  assert.equal(outcome.verified_findings, 1);
  assert.deepEqual(
    order,
    ["evidence:match-1", "case:match-1"],
    "evidence must be captured before case prep",
  );
});

test("runCopyrightIntelForUser: capture_failed evidence blocks case prep for that finding", async () => {
  const supabase = createMockSupabase({
    protected_assets: [
      { id: "asset-1", user_id: "user-1", name: "Poster", storage_path: "p1", active: true },
    ],
  });
  let caseCalled = false;

  await runCopyrightIntelForUser(supabase, "user-1", 1440, {
    executeCopyrightScanById: async ({ scanId }) => {
      supabase._store.copyright_matches = [
        {
          id: "match-1",
          scan_id: scanId,
          source_url: "https://pirate.example/dead",
          confidence_band: "confirmed",
          review_status: "pending",
        },
      ];
      return { status: "completed" };
    },
    captureEvidence: async () => ({ ok: true, evidenceId: null, status: "capture_failed" }),
    onVerifiedFinding: async () => {
      caseCalled = true;
      return { caseId: null, status: "SKIPPED", idempotencyDeduplicated: false };
    },
  });

  assert.equal(
    caseCalled,
    false,
    "must not advance enforcement eligibility without captured evidence",
  );
});

test("runCopyrightIntelForUser: one asset's pipeline failure does not stop the rest of the batch", async () => {
  const supabase = createMockSupabase({
    protected_assets: [
      { id: "asset-fail", user_id: "user-1", name: "Bad", storage_path: "p1", active: true },
      { id: "asset-ok", user_id: "user-1", name: "Good", storage_path: "p2", active: true },
    ],
  });
  const attempted: string[] = [];

  const outcome = await runCopyrightIntelForUser(supabase, "user-1", 1440, {
    executeCopyrightScanById: async ({ scanId }) => {
      const scan = supabase._store.copyright_scans.find((s) => s.id === scanId)!;
      attempted.push(scan.protected_asset_id);
      if (scan.protected_asset_id === "asset-fail") {
        throw new Error("SerpApi quota exceeded");
      }
      supabase._store.copyright_matches = supabase._store.copyright_matches ?? [];
      supabase._store.copyright_matches.push({
        id: "match-ok",
        scan_id: scanId,
        source_url: "https://pirate.example/ok",
        confidence_band: "confirmed",
        review_status: "pending",
      });
      return { status: "completed" };
    },
    captureEvidence: async () => ({ ok: true, evidenceId: "ev-1", status: "verified" }),
    onVerifiedFinding: async () => ({
      caseId: "case-1",
      status: "QUEUED",
      idempotencyDeduplicated: false,
    }),
  });

  assert.deepEqual(attempted.sort(), ["asset-fail", "asset-ok"], "both assets must be attempted");
  assert.equal(outcome.status, "PARTIAL");
  assert.equal(outcome.verified_findings, 1, "the healthy asset's finding is still counted");
});

test("runCopyrightIntelForUser: tenant isolation — only the requested user's assets are scanned", async () => {
  const supabase = createMockSupabase({
    protected_assets: [
      { id: "a-user1", user_id: "user-1", name: "Mine", storage_path: "p1", active: true },
      { id: "a-user2", user_id: "user-2", name: "Theirs", storage_path: "p2", active: true },
    ],
  });
  const scannedAssetIds: string[] = [];

  await runCopyrightIntelForUser(supabase, "user-1", 1440, {
    executeCopyrightScanById: async ({ scanId }) => {
      const scan = supabase._store.copyright_scans.find((s) => s.id === scanId)!;
      scannedAssetIds.push(scan.protected_asset_id);
      return { status: "completed" };
    },
    captureEvidence: async () => ({ ok: true, evidenceId: null, status: "verified" }),
    onVerifiedFinding: async () => ({
      caseId: null,
      status: "QUEUED",
      idempotencyDeduplicated: false,
    }),
  });

  assert.deepEqual(scannedAssetIds, ["a-user1"]);
});
