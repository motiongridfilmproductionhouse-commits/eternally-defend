/**
 * Protected-Asset Face Bootstrap (Path C). Lets a customer with no liveness
 * and no manually-created Deepfake Intel profile still build face-reference
 * coverage from screenshots already sitting in their protected_assets.
 *
 * This module only ever gets as far as CANDIDATE GENERATION — extracting
 * faces and grouping recurring ones into clusters for a human to look at.
 * It never decides who anyone is: no cluster is trusted, compared against
 * anything, or promoted here. That happens only in identity-bootstrap.functions.ts's
 * confirmIdentityCandidateCluster, and only after an authorized admin
 * explicitly confirms which cluster is the protected person.
 *
 * Reuses the existing Face Reference Extraction pipeline unchanged
 * (detectGrid/cropTile/analyzeFace via processProtectedAssetForFaceReferences
 * in bootstrap mode — referenceImages: []) rather than a second image
 * pipeline, and the existing clustering module for grouping.
 */
import {
  processProtectedAssetForFaceReferences,
  type ProtectedAssetRow,
  type PipelineDeps,
} from "../face-reference-extraction/pipeline.server";
import { detectGridTiles, cropTile } from "../face-reference-extraction/grid-detect.server";
import { analyzeTileForFace } from "../face-reference-extraction/tile-face-analysis.server";
import { computePerceptualHash, checkDuplicate } from "../face-reference-extraction/dedupe.server";
import {
  clusterCandidateFaces,
  type ClusterCandidate,
} from "../face-reference-extraction/clustering.server";
import { getTrustedFaceAnchorsForUser, hasTrustedAnchor } from "../trusted-face-anchors.server";

export interface BootstrapDispatchDeps {
  downloadAssetBytes?: (storagePath: string) => Promise<Uint8Array>;
  uploadTileBytes?: (key: string, bytes: Uint8Array) => Promise<void>;
  sha256?: (bytes: Uint8Array) => Promise<string>;
  downloadCandidateTileBytes?: (storageKey: string) => Promise<Uint8Array>;
  compareFacesForClustering?: (a: Uint8Array, b: Uint8Array) => Promise<number>;
  detectGrid?: PipelineDeps["detectGrid"];
  cropTile?: PipelineDeps["cropTile"];
  analyzeFace?: PipelineDeps["analyzeFace"];
  computePhash?: PipelineDeps["computePhash"];
  checkDuplicate?: PipelineDeps["checkDuplicate"];
}

export interface BootstrapOutcome {
  status:
    | "ANCHOR_ALREADY_EXISTS"
    | "NO_PROTECTED_ASSETS"
    | "NO_USABLE_FACES_FOUND"
    | "CANDIDATES_GENERATED"
    | "PARTIAL";
  assetsProcessed: number;
  candidatesFound: number;
  newClustersCreated: number;
  pendingClusters: number;
}

const BOOTSTRAP_ASSET_BATCH_SIZE = 30;
const MAX_CLUSTERING_CANDIDATES = 80;

/** Never actually called in bootstrap mode (referenceImages is always []); throwing proves that at runtime instead of silently no-op-ing. */
function unreachableInBootstrap(name: string): never {
  throw new Error(`[protected-asset-bootstrap] ${name} must never be called in bootstrap mode`);
}

export async function runProtectedAssetBootstrapForUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  userId: string,
  deps: BootstrapDispatchDeps = {},
): Promise<BootstrapOutcome> {
  const io = await import("./face-reference-extraction-io.server");
  const downloadAssetBytes = deps.downloadAssetBytes ?? io.downloadAssetBytes;
  const uploadTileBytes = deps.uploadTileBytes ?? io.uploadTileBytes;
  const sha256 = deps.sha256 ?? io.sha256;
  const downloadCandidateTileBytes =
    deps.downloadCandidateTileBytes ?? io.downloadCandidateTileBytes;
  const compareFacesForClustering = deps.compareFacesForClustering ?? io.compareFacesForClustering;
  const detectGrid = deps.detectGrid ?? detectGridTiles;
  const doCropTile = deps.cropTile ?? cropTile;
  const analyzeFace = deps.analyzeFace ?? analyzeTileForFace;
  const computePhash = deps.computePhash ?? computePerceptualHash;
  const doCheckDuplicate = deps.checkDuplicate ?? checkDuplicate;

  const zero = {
    assetsProcessed: 0,
    candidatesFound: 0,
    newClustersCreated: 0,
    pendingClusters: 0,
  };

  const anchorResult = await getTrustedFaceAnchorsForUser(supabaseAdmin, userId);
  if (hasTrustedAnchor(anchorResult)) {
    return { status: "ANCHOR_ALREADY_EXISTS", ...zero };
  }

  const { data: pendingAssets } = await supabaseAdmin
    .from("protected_assets")
    .select("id, user_id, storage_path, created_at, grid_screenshot_status, metadata")
    .eq("user_id", userId)
    .eq("kind", "photo")
    .in("grid_screenshot_status", ["UNSCREENED", "PENDING"])
    .order("created_at", { ascending: true })
    .limit(BOOTSTRAP_ASSET_BATCH_SIZE);

  const assets = (pendingAssets ?? []) as ProtectedAssetRow[];
  if (assets.length === 0) {
    return { status: "NO_PROTECTED_ASSETS", ...zero };
  }

  let assetsProcessed = 0;
  let candidatesFound = 0;

  for (const asset of assets) {
    try {
      const outcome = await processProtectedAssetForFaceReferences({
        supabase: supabaseAdmin,
        userId,
        profileId: null,
        asset,
        referenceImages: [],
        existingReferences: [],
        deps: {
          downloadAssetBytes: (storagePath) => downloadAssetBytes(storagePath),
          uploadTileBytes: (key, bytes) => uploadTileBytes(key, bytes),
          sha256,
          detectGrid,
          cropTile: doCropTile,
          analyzeFace,
          matchIdentity: () => unreachableInBootstrap("matchIdentity"),
          computePhash,
          checkDuplicate: doCheckDuplicate,
          promoteToReferenceFace: () => unreachableInBootstrap("promoteToReferenceFace"),
        },
      });
      assetsProcessed += 1;
      candidatesFound += outcome.unconfirmedCandidates;
    } catch (err) {
      console.error("[protected-asset-bootstrap] asset processing failed", asset.id, err);
    }
  }

  // Cluster only tiles that don't already belong to a cluster — a second
  // run against unchanged assets finds nothing new here (tile-level
  // idempotency already means no new UNCONFIRMED_IDENTITY_CANDIDATE rows
  // were created above), so zero new clusters get created either.
  // Filtered for cluster_id in JS rather than `.is("cluster_id", null)` in
  // the query so this behaves identically against the real Postgres column
  // and against test fixtures that predate this column being set at all.
  const { data: candidateTiles } = await supabaseAdmin
    .from("protected_asset_grid_tiles")
    .select("id, tile_storage_path, cluster_id, created_at")
    .eq("user_id", userId)
    .eq("promotion_status", "UNCONFIRMED_IDENTITY_CANDIDATE")
    .order("created_at", { ascending: true })
    .limit(MAX_CLUSTERING_CANDIDATES);

  let newClustersCreated = 0;
  const tilesWithPaths = (
    (candidateTiles ?? []) as Array<{
      id: string;
      tile_storage_path: string | null;
      cluster_id: string | null;
    }>
  ).filter((t) => t.tile_storage_path && !t.cluster_id);

  if (tilesWithPaths.length > 0) {
    const candidates: ClusterCandidate[] = [];
    for (const tile of tilesWithPaths) {
      try {
        const bytes = await downloadCandidateTileBytes(tile.tile_storage_path!);
        candidates.push({ tileId: tile.id, imageBytes: bytes });
      } catch (err) {
        console.warn("[protected-asset-bootstrap] failed to load candidate tile", tile.id, err);
      }
    }

    const clusters = await clusterCandidateFaces({
      candidates,
      compareFaces: compareFacesForClustering,
    });

    for (const cluster of clusters) {
      const { data: clusterRow, error } = await supabaseAdmin
        .from("face_identity_candidate_clusters")
        .insert({
          user_id: userId,
          representative_tile_id: cluster.representativeTileId,
          tile_count: cluster.tileIds.length,
          status: "PENDING",
        })
        .select("id")
        .single();
      if (error || !clusterRow) {
        console.error("[protected-asset-bootstrap] failed to create cluster", error);
        continue;
      }
      newClustersCreated += 1;
      for (const tileId of cluster.tileIds) {
        await supabaseAdmin
          .from("protected_asset_grid_tiles")
          .update({ cluster_id: clusterRow.id })
          .eq("id", tileId)
          .eq("user_id", userId);
      }
    }
  }

  const { count: pendingClusters } = await supabaseAdmin
    .from("face_identity_candidate_clusters")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "PENDING");

  return {
    status: candidatesFound > 0 ? "CANDIDATES_GENERATED" : "NO_USABLE_FACES_FOUND",
    assetsProcessed,
    candidatesFound,
    newClustersCreated,
    pendingClusters: pendingClusters ?? 0,
  };
}
