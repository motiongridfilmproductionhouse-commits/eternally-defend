import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createMockSupabase } from "../test-utils";
import { runProtectedAssetBootstrapForUser } from "./protected-asset-bootstrap.server";

function sha256(bytes: Uint8Array): Promise<string> {
  return Promise.resolve(createHash("sha256").update(bytes).digest("hex"));
}

/** Which "person" each (assetId, tileIndex) crop belongs to — test fixture only. */
const PERSON_MAP: Record<string, string> = {
  "asset-1:0": "lena",
  "asset-2:0": "lena",
  "asset-2:1": "costar",
};

function tileKeyFromBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString();
}

function buildFakeStorage() {
  const store = new Map<string, Uint8Array>();
  return {
    uploadTileBytes: async (key: string, bytes: Uint8Array) => {
      store.set(key, bytes);
    },
    downloadCandidateTileBytes: async (key: string) => {
      const bytes = store.get(key);
      if (!bytes) throw new Error(`no fake object for ${key}`);
      return bytes;
    },
  };
}

function buildDeps(storage: ReturnType<typeof buildFakeStorage>) {
  return {
    downloadAssetBytes: async () => new Uint8Array([1, 2, 3]),
    uploadTileBytes: storage.uploadTileBytes,
    downloadCandidateTileBytes: storage.downloadCandidateTileBytes,
    sha256,
    detectGrid: async (screenshotBytes: Uint8Array) => {
      const assetId = Buffer.from(screenshotBytes).toString();
      const tileCount = assetId === "asset-1" ? 1 : 2;
      return {
        tiles: Array.from({ length: tileCount }, (_, i) => ({
          x: i * 10,
          y: 0,
          width: 10,
          height: 10,
        })),
        confidence: "HIGH" as const,
        imageWidth: tileCount * 10,
        imageHeight: 10,
      };
    },
    cropTile: async (screenshotBytes: Uint8Array, tile: { x: number }) => {
      const assetId = Buffer.from(screenshotBytes).toString();
      const tileIndex = tile.x / 10;
      return Buffer.from(`${assetId}:${tileIndex}`);
    },
    analyzeFace: async () => ({
      classification: "USABLE_FACE" as const,
      confidence: 91,
      boundingBox: null,
    }),
    compareFacesForClustering: async (a: Uint8Array, b: Uint8Array) => {
      const personA = PERSON_MAP[tileKeyFromBytes(a)];
      const personB = PERSON_MAP[tileKeyFromBytes(b)];
      return personA === personB ? 96 : 20;
    },
    computePhash: async (bytes: Uint8Array) => Buffer.from(bytes).toString("hex"),
    checkDuplicate: async () => ({ isDuplicate: false, duplicateOfReferenceId: null }),
  };
}

function twoAssets() {
  return [
    {
      id: "asset-1",
      user_id: "user-1",
      kind: "photo",
      storage_path: "asset-1",
      created_at: "2026-08-01T00:00:00.000Z",
      grid_screenshot_status: "UNSCREENED",
    },
    {
      id: "asset-2",
      user_id: "user-1",
      kind: "photo",
      storage_path: "asset-2",
      created_at: "2026-08-02T00:00:00.000Z",
      grid_screenshot_status: "UNSCREENED",
    },
  ];
}

// downloadAssetBytes above always returns [1,2,3] regardless of asset — but
// detectGrid/cropTile need to know WHICH asset they're looking at, so this
// harness routes screenshot bytes through the asset's own storage_path
// string instead (set to the asset id for readability) and overrides
// downloadAssetBytes accordingly per-call via the dispatcher's real
// `storagePath` argument.
function buildDepsWithRealDownload(storage: ReturnType<typeof buildFakeStorage>) {
  const base = buildDeps(storage);
  return {
    ...base,
    downloadAssetBytes: async (storagePath: string) => Buffer.from(storagePath),
  };
}

test("no trusted anchor, no protected assets -> NO_PROTECTED_ASSETS, no work done", async () => {
  const supabase = createMockSupabase();
  const outcome = await runProtectedAssetBootstrapForUser(supabase, "user-1");
  assert.deepEqual(outcome, {
    status: "NO_PROTECTED_ASSETS",
    assetsProcessed: 0,
    candidatesFound: 0,
    newClustersCreated: 0,
    pendingClusters: 0,
  });
});

test("a trusted anchor already exists -> ANCHOR_ALREADY_EXISTS, bootstrap does not run (the normal recurring pipeline handles it instead)", async () => {
  const supabase = createMockSupabase({
    protected_face_profiles: [{ id: "pfp-1", user_id: "user-1", status: "FACE_VERIFIED" }],
    protected_faces: [
      { id: "pf-1", user_id: "user-1", status: "ACTIVE", s3_bucket: "b", s3_key: "k1" },
    ],
    protected_assets: twoAssets(),
  });
  const outcome = await runProtectedAssetBootstrapForUser(supabase, "user-1");
  assert.equal(outcome.status, "ANCHOR_ALREADY_EXISTS");
  assert.equal((supabase._store["protected_asset_grid_tiles"] ?? []).length, 0);
});

test("extracts candidates across all eligible assets and clusters recurring faces, without ever comparing against an anchor or promoting anything", async () => {
  const supabase = createMockSupabase({ protected_assets: twoAssets() });
  const storage = buildFakeStorage();
  const deps = buildDepsWithRealDownload(storage);

  const outcome = await runProtectedAssetBootstrapForUser(supabase, "user-1", deps);

  assert.equal(outcome.status, "CANDIDATES_GENERATED");
  assert.equal(outcome.assetsProcessed, 2);
  assert.equal(outcome.candidatesFound, 3, "1 face in asset-1 + 2 faces in asset-2");
  assert.equal(outcome.newClustersCreated, 2, "lena (2 appearances) + costar (1 appearance)");
  assert.equal(outcome.pendingClusters, 2);

  const clusters = supabase._store["face_identity_candidate_clusters"] ?? [];
  assert.equal(clusters.length, 2);
  for (const cluster of clusters) assert.equal(cluster.status, "PENDING");
  const sizes = clusters.map((c) => c.tile_count).sort();
  assert.deepEqual(sizes, [1, 2]);

  // Never touches deepfake_reference_faces — candidate generation alone
  // must never create a trusted reference.
  assert.equal((supabase._store["deepfake_reference_faces"] ?? []).length, 0);

  const tiles = supabase._store["protected_asset_grid_tiles"] ?? [];
  assert.equal(tiles.length, 3);
  for (const tile of tiles) {
    assert.equal(tile.promotion_status, "UNCONFIRMED_IDENTITY_CANDIDATE");
    assert.ok(tile.cluster_id, "every candidate tile ends up assigned to a cluster");
  }
});

test("idempotency: running bootstrap twice against unchanged assets creates zero duplicate tiles and zero duplicate clusters", async () => {
  const supabase = createMockSupabase({ protected_assets: twoAssets() });
  const storage = buildFakeStorage();
  const deps = buildDepsWithRealDownload(storage);

  const first = await runProtectedAssetBootstrapForUser(supabase, "user-1", deps);
  assert.equal(first.newClustersCreated, 2);

  const second = await runProtectedAssetBootstrapForUser(supabase, "user-1", deps);
  // Every asset is now grid_screenshot_status='PENDING' (unconfirmed
  // candidates remain), still eligible, so assetsProcessed stays >0 — but
  // tile-level idempotency means no NEW tile rows, and every tile is
  // already clustered, so no new clusters either.
  assert.equal(second.newClustersCreated, 0);
  assert.equal(second.candidatesFound, 3, "same tiles re-detected as candidates, not duplicated");

  assert.equal(
    (supabase._store["protected_asset_grid_tiles"] ?? []).length,
    3,
    "no duplicate tile rows",
  );
  assert.equal(
    (supabase._store["face_identity_candidate_clusters"] ?? []).length,
    2,
    "no duplicate cluster rows",
  );
});

test("cross-user isolation: bootstrap for User A never touches User B's protected_assets or clusters", async () => {
  const supabase = createMockSupabase({
    protected_assets: [
      ...twoAssets(),
      {
        id: "asset-b",
        user_id: "user-B",
        kind: "photo",
        storage_path: "asset-b",
        created_at: "2026-08-01T00:00:00.000Z",
        grid_screenshot_status: "UNSCREENED",
      },
    ],
  });
  const storage = buildFakeStorage();
  const deps = buildDepsWithRealDownload(storage);

  const outcome = await runProtectedAssetBootstrapForUser(supabase, "user-1", deps);
  assert.equal(outcome.assetsProcessed, 2, "must not process user-B's asset");

  const tiles = supabase._store["protected_asset_grid_tiles"] ?? [];
  assert.ok(tiles.every((t) => t.user_id === "user-1"));
  const clusters = supabase._store["face_identity_candidate_clusters"] ?? [];
  assert.ok(clusters.every((c) => c.user_id === "user-1"));
});
