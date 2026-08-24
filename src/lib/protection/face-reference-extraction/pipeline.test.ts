import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createMockSupabase } from "../test-utils";
import {
  processProtectedAssetForFaceReferences,
  type PipelineDeps,
  type ProtectedAssetRow,
} from "./pipeline.server";
import type { TileFaceAnalysis } from "./tile-face-analysis.server";
import type { IdentityMatchResult } from "./identity-match.server";

function sha256(bytes: Uint8Array): Promise<string> {
  return Promise.resolve(createHash("sha256").update(bytes).digest("hex"));
}

/** Deterministic per-tile fake bytes, face classification, and identity result, keyed by tile index. */
const TILE_PLAN: Array<{
  classification: TileFaceAnalysis["classification"];
  identity: IdentityMatchResult["status"];
  similarity: number | null;
}> = [
  { classification: "USABLE_FACE", identity: "MATCHED_PROTECTED_SUBJECT", similarity: 97 },
  { classification: "NO_FACE", identity: "NOT_SUBJECT", similarity: null },
  { classification: "USABLE_FACE", identity: "PROBABLE_MATCH", similarity: 88 },
];

function buildDeps(
  mockSupabase: ReturnType<typeof createMockSupabase>,
  promoteCallLog: string[],
): PipelineDeps {
  return {
    downloadAssetBytes: async () => new Uint8Array([1, 2, 3]),
    uploadTileBytes: async () => {},
    sha256,
    detectGrid: async () => ({
      tiles: TILE_PLAN.map((_, i) => ({ x: i * 10, y: 0, width: 10, height: 10 })),
      confidence: "HIGH",
      imageWidth: 30,
      imageHeight: 10,
    }),
    cropTile: async (_bytes, tile) => Buffer.from(`tile-${tile.x}`),
    analyzeFace: async (tileBytes) => {
      const idx = Number(Buffer.from(tileBytes).toString().split("-")[1]) / 10;
      return { classification: TILE_PLAN[idx].classification, confidence: 92, boundingBox: null };
    },
    matchIdentity: async ({ tileBytes }) => {
      const idx = Number(Buffer.from(tileBytes).toString().split("-")[1]) / 10;
      return {
        status: TILE_PLAN[idx].identity,
        similarity: TILE_PLAN[idx].similarity,
        matchedReferenceIndex: null,
      };
    },
    computePhash: async (bytes) => Buffer.from(bytes).toString("hex"),
    checkDuplicate: async () => ({ isDuplicate: false, duplicateOfReferenceId: null }),
    promoteToReferenceFace: async (input) => {
      promoteCallLog.push(`${input.sourceAssetId}:${input.sourceTileId}`);
      const { data } = await mockSupabase
        .from("deepfake_reference_faces")
        .insert({
          profile_id: input.profileId,
          storage_path: input.tileStorageKey,
          rekognition_face_id: `fake-face-${promoteCallLog.length}`,
          face_confidence: input.faceConfidence,
          reference_tier: "SCREENSHOT_DERIVED_REFERENCE",
          source_type: "SCREENSHOT_DERIVED",
          source_asset_id: input.sourceAssetId,
          source_tile_id: input.sourceTileId,
        })
        .select("id")
        .single();
      return { referenceId: data!.id };
    },
  };
}

function baseAsset(overrides: Partial<ProtectedAssetRow> = {}): ProtectedAssetRow {
  return {
    id: "asset-1",
    user_id: "user-1",
    storage_path: "clients/user-1/assets/screenshot.jpg",
    created_at: "2026-08-01T00:00:00.000Z",
    grid_screenshot_status: "UNSCREENED",
    ...overrides,
  };
}

test("processes a screenshot: matches auto-promote, no-face rejects, probable-match queues for review", async () => {
  const mockSupabase = createMockSupabase({ protected_assets: [baseAsset()] });
  const promoteCallLog: string[] = [];
  const deps = buildDeps(mockSupabase, promoteCallLog);

  const outcome = await processProtectedAssetForFaceReferences({
    supabase: mockSupabase,
    userId: "user-1",
    profileId: "profile-1",
    asset: baseAsset(),
    referenceImages: [new Uint8Array([9, 9, 9])],
    existingReferences: [],
    deps,
  });

  assert.equal(outcome.status, "COMPLETED");
  assert.equal(outcome.tilesCreated, 3);
  assert.equal(outcome.usableFaces, 2);
  assert.equal(outcome.matched, 1);
  assert.equal(outcome.pendingReview, 1);
  assert.equal(promoteCallLog.length, 1);

  const tileRows = mockSupabase._store["protected_asset_grid_tiles"] ?? [];
  assert.equal(tileRows.length, 3);
  const refRows = mockSupabase._store["deepfake_reference_faces"] ?? [];
  assert.equal(refRows.length, 1);
  assert.equal(refRows[0].reference_tier, "SCREENSHOT_DERIVED_REFERENCE");

  const matchedTile = tileRows.find((r) => r.promotion_status === "AUTO_APPROVED");
  assert.ok(matchedTile);
  assert.equal(matchedTile!.promoted_reference_id, refRows[0].id);
});

test("asset-level idempotency: re-running against an already-COMPLETED asset is a pure no-op", async () => {
  const mockSupabase = createMockSupabase({ protected_assets: [baseAsset()] });
  const promoteCallLog: string[] = [];
  const deps = buildDeps(mockSupabase, promoteCallLog);

  await processProtectedAssetForFaceReferences({
    supabase: mockSupabase,
    userId: "user-1",
    profileId: "profile-1",
    asset: baseAsset(),
    referenceImages: [new Uint8Array([9, 9, 9])],
    existingReferences: [],
    deps,
  });

  const tileCountAfterFirstRun = (mockSupabase._store["protected_asset_grid_tiles"] ?? []).length;
  const refCountAfterFirstRun = (mockSupabase._store["deepfake_reference_faces"] ?? []).length;

  const updatedAsset = mockSupabase._store["protected_assets"].find((r) => r.id === "asset-1");
  assert.equal(updatedAsset!.grid_screenshot_status, "COMPLETED");

  const secondOutcome = await processProtectedAssetForFaceReferences({
    supabase: mockSupabase,
    userId: "user-1",
    profileId: "profile-1",
    asset: baseAsset({ grid_screenshot_status: updatedAsset!.grid_screenshot_status }),
    referenceImages: [new Uint8Array([9, 9, 9])],
    existingReferences: [],
    deps,
  });

  assert.equal(secondOutcome.status, "ALREADY_DONE");
  assert.equal(promoteCallLog.length, 1, "no new promotion calls on the second run");
  assert.equal(
    (mockSupabase._store["protected_asset_grid_tiles"] ?? []).length,
    tileCountAfterFirstRun,
  );
  assert.equal(
    (mockSupabase._store["deepfake_reference_faces"] ?? []).length,
    refCountAfterFirstRun,
  );
});

test("tile-level idempotency: a forced re-scan of the same content upserts onto existing tiles instead of duplicating", async () => {
  const mockSupabase = createMockSupabase({ protected_assets: [baseAsset()] });
  const promoteCallLog: string[] = [];
  const deps = buildDeps(mockSupabase, promoteCallLog);

  await processProtectedAssetForFaceReferences({
    supabase: mockSupabase,
    userId: "user-1",
    profileId: "profile-1",
    asset: baseAsset(),
    referenceImages: [new Uint8Array([9, 9, 9])],
    existingReferences: [],
    deps,
  });

  // Simulate an operator forcing a re-scan (asset flipped back to PENDING)
  // while the screenshot's content — and therefore every tile's bytes and
  // sha256 — is unchanged.
  const secondOutcome = await processProtectedAssetForFaceReferences({
    supabase: mockSupabase,
    userId: "user-1",
    profileId: "profile-1",
    asset: baseAsset({ grid_screenshot_status: "PENDING" }),
    referenceImages: [new Uint8Array([9, 9, 9])],
    existingReferences: [
      ...(mockSupabase._store["deepfake_reference_faces"] ?? []).map((r) => ({
        id: r.id,
        phash: null,
        imageBytes: new Uint8Array([0]),
      })),
    ],
    deps,
  });

  assert.equal(secondOutcome.status, "COMPLETED");
  assert.equal(secondOutcome.tilesCreated, 3);
  assert.equal(promoteCallLog.length, 1, "unchanged tile content must not be re-promoted");
  assert.equal(
    (mockSupabase._store["protected_asset_grid_tiles"] ?? []).length,
    3,
    "no duplicate tile rows",
  );
  assert.equal(
    (mockSupabase._store["deepfake_reference_faces"] ?? []).length,
    1,
    "no duplicate reference faces",
  );
});
