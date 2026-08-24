/**
 * Per-asset pipeline: EXISTING PROTECTED SCREENSHOT -> DETECT GRID ->
 * SEGMENT INTO TILES -> DETECT FACES PER TILE -> QUALITY CHECK ->
 * IDENTITY MATCH -> DEDUPLICATE -> APPROVED SECONDARY FACE REFERENCES.
 *
 * Idempotent at two levels:
 *  - asset-level: no-ops immediately if the asset's grid_screenshot_status
 *    is already COMPLETED or NOT_APPLICABLE.
 *  - tile-level: upserts on (parent_asset_id, tile_index); a tile already
 *    analyzed with the same tile_sha256 is never re-analyzed or re-promoted.
 *
 * Every dependency that touches the network (S3, Rekognition) is injected so
 * this function is unit-testable against a mocked Supabase client and fake
 * detectors — see pipeline.test.ts.
 */
import { detectGridTiles, cropTile, type DetectedTile } from "./grid-detect.server";
import { analyzeTileForFace, type TileFaceAnalysis } from "./tile-face-analysis.server";
import {
  matchTileAgainstReferences,
  isAutoPromotable,
  isReviewable,
} from "./identity-match.server";
import { computePerceptualHash, checkDuplicate, type ExistingReference } from "./dedupe.server";

export interface ProtectedAssetRow {
  id: string;
  user_id: string;
  storage_path: string | null;
  created_at: string;
  grid_screenshot_status: string;
  metadata?: Record<string, unknown> | null;
}

export interface PipelineDeps {
  downloadAssetBytes: (storagePath: string) => Promise<Uint8Array>;
  uploadTileBytes: (key: string, bytes: Uint8Array) => Promise<void>;
  sha256: (bytes: Uint8Array) => Promise<string>;
  detectGrid: typeof detectGridTiles;
  cropTile: typeof cropTile;
  analyzeFace: typeof analyzeTileForFace;
  matchIdentity: typeof matchTileAgainstReferences;
  computePhash: typeof computePerceptualHash;
  checkDuplicate: typeof checkDuplicate;
  /**
   * Indexes a promoted face into Rekognition + inserts the
   * deepfake_reference_faces row. Returns the new row's id. `profileId` is
   * null when the customer has no deepfake_target_profiles row yet (a
   * liveness-only trusted anchor) — the caller is responsible for resolving
   * (and lazily creating, if truly needed) a real profile id before the
   * insert; the pipeline itself never creates one.
   */
  promoteToReferenceFace: (input: {
    userId: string;
    profileId: string | null;
    tileBytes: Uint8Array;
    tileStorageKey: string;
    sourceAssetId: string;
    sourceTileId: string;
    faceConfidence: number | null;
    phash: string;
  }) => Promise<{ referenceId: string }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SupabaseLike = any;

export interface ProcessAssetInput {
  supabase: SupabaseLike;
  userId: string;
  /** null when the trusted anchor is liveness-only and no deepfake_target_profiles row exists yet. */
  profileId: string | null;
  asset: ProtectedAssetRow;
  referenceImages: Uint8Array[];
  existingReferences: ExistingReference[];
  deps: PipelineDeps;
}

export interface ProcessAssetOutcome {
  status: "COMPLETED" | "NOT_APPLICABLE" | "ALREADY_DONE" | "FAILED";
  tilesCreated: number;
  usableFaces: number;
  matched: number;
  pendingReview: number;
  rejected: number;
  deduped: number;
}

const MAX_TILES_PER_ASSET = 30;

export async function processProtectedAssetForFaceReferences(
  input: ProcessAssetInput,
): Promise<ProcessAssetOutcome> {
  const { supabase, userId, profileId, asset, referenceImages, deps } = input;
  const zero: Omit<ProcessAssetOutcome, "status"> = {
    tilesCreated: 0,
    usableFaces: 0,
    matched: 0,
    pendingReview: 0,
    rejected: 0,
    deduped: 0,
  };

  if (
    asset.grid_screenshot_status === "COMPLETED" ||
    asset.grid_screenshot_status === "NOT_APPLICABLE"
  ) {
    return { status: "ALREADY_DONE", ...zero };
  }
  if (!asset.storage_path) {
    await supabase
      .from("protected_assets")
      .update({ grid_screenshot_status: "FAILED" })
      .eq("id", asset.id)
      .eq("user_id", userId);
    return { status: "FAILED", ...zero };
  }

  await supabase
    .from("protected_assets")
    .update({ grid_screenshot_status: "PROCESSING" })
    .eq("id", asset.id)
    .eq("user_id", userId);

  let screenshotBytes: Uint8Array;
  let grid: { tiles: DetectedTile[]; confidence: "HIGH" | "LOW" | "NONE" };
  try {
    screenshotBytes = await deps.downloadAssetBytes(asset.storage_path);
    grid = await deps.detectGrid(screenshotBytes);
  } catch (err) {
    console.error("[face-reference-extraction] pipeline failed to load/detect", asset.id, err);
    await supabase
      .from("protected_assets")
      .update({ grid_screenshot_status: "FAILED" })
      .eq("id", asset.id)
      .eq("user_id", userId);
    return { status: "FAILED", ...zero };
  }

  if (grid.confidence === "NONE" || grid.tiles.length === 0) {
    await supabase
      .from("protected_assets")
      .update({ grid_screenshot_status: "NOT_APPLICABLE", grid_tile_count: 0 })
      .eq("id", asset.id)
      .eq("user_id", userId);
    return { status: "NOT_APPLICABLE", ...zero };
  }

  const tiles = grid.tiles.slice(0, MAX_TILES_PER_ASSET);
  const counts = { ...zero };
  // Duplicate promotions within the same run must not double-count against
  // each other — track newly promoted references from this pass too.
  const promotedThisRun: ExistingReference[] = [];

  for (let tileIndex = 0; tileIndex < tiles.length; tileIndex++) {
    const tile = tiles[tileIndex];

    const { data: existingTile } = await supabase
      .from("protected_asset_grid_tiles")
      .select("id, tile_sha256, promotion_status")
      .eq("parent_asset_id", asset.id)
      .eq("tile_index", tileIndex)
      .maybeSingle();

    const tileBytes = await deps.cropTile(screenshotBytes, tile);
    const tileSha256 = await deps.sha256(tileBytes);

    if (existingTile && existingTile.tile_sha256 === tileSha256) {
      // Already fully analyzed in a prior run — pure no-op, this is the
      // tile-level idempotency guarantee.
      counts.tilesCreated += 1;
      continue;
    }

    const analysis: TileFaceAnalysis = await deps.analyzeFace(tileBytes);
    counts.tilesCreated += 1;

    const baseTileRow = {
      user_id: userId,
      parent_asset_id: asset.id,
      tile_index: tileIndex,
      crop_x: tile.x,
      crop_y: tile.y,
      crop_width: tile.width,
      crop_height: tile.height,
      source_type: "SOCIAL_GRID_SCREENSHOT",
      platform: "INSTAGRAM",
      source_media_type: "IMAGE",
      captured_at: asset.created_at,
      tile_sha256: tileSha256,
      face_classification: analysis.classification,
      face_confidence: analysis.confidence,
      face_bounding_box: analysis.boundingBox,
    };

    if (analysis.classification !== "USABLE_FACE") {
      await supabase
        .from("protected_asset_grid_tiles")
        .upsert(
          { ...baseTileRow, promotion_status: "NOT_CANDIDATE" },
          { onConflict: "parent_asset_id,tile_index" },
        );
      continue;
    }

    counts.usableFaces += 1;

    const identity = await deps.matchIdentity({
      tileBytes,
      referenceImages,
    });

    if (!isAutoPromotable(identity.status) && !isReviewable(identity.status)) {
      // NOT_SUBJECT — a face was found but it independently failed to match
      // the protected identity. Recorded for auditability, never promotable.
      counts.rejected += 1;
      await supabase.from("protected_asset_grid_tiles").upsert(
        {
          ...baseTileRow,
          identity_status: identity.status,
          face_match_similarity: identity.similarity,
          promotion_status: "NOT_CANDIDATE",
        },
        { onConflict: "parent_asset_id,tile_index" },
      );
      continue;
    }

    if (!isAutoPromotable(identity.status)) {
      // PROBABLE_MATCH / AMBIGUOUS / REQUIRES_HUMAN_REVIEW — queued for the
      // customer to manually approve from the View References screen.
      counts.pendingReview += 1;
      await supabase.from("protected_asset_grid_tiles").upsert(
        {
          ...baseTileRow,
          identity_status: identity.status,
          face_match_similarity: identity.similarity,
          promotion_status: "PENDING_REVIEW",
        },
        { onConflict: "parent_asset_id,tile_index" },
      );
      continue;
    }

    // MATCHED_PROTECTED_SUBJECT — eligible for auto-promotion, pending dedupe.
    const candidatePhash = await deps.computePhash(tileBytes);
    const dedupe = await deps.checkDuplicate({
      candidateBytes: tileBytes,
      candidatePhash,
      existingReferences: [...input.existingReferences, ...promotedThisRun],
    });

    if (dedupe.isDuplicate) {
      counts.deduped += 1;
      await supabase.from("protected_asset_grid_tiles").upsert(
        {
          ...baseTileRow,
          identity_status: identity.status,
          face_match_similarity: identity.similarity,
          matched_reference_face_id: dedupe.duplicateOfReferenceId,
          promotion_status: "DUPLICATE",
        },
        { onConflict: "parent_asset_id,tile_index" },
      );
      continue;
    }

    // Insert the tile row first (without a promoted_reference_id yet) so we
    // have a stable tile id to attribute the new reference face to. Upsert
    // and re-fetch as two steps rather than chaining .select().single() off
    // the upsert — that chain only reliably scopes to the just-written row
    // once every caller narrows it back down by the conflict key, which a
    // plain re-fetch does unambiguously.
    await supabase.from("protected_asset_grid_tiles").upsert(
      {
        ...baseTileRow,
        identity_status: identity.status,
        face_match_similarity: identity.similarity,
        promotion_status: "PENDING_REVIEW",
      },
      { onConflict: "parent_asset_id,tile_index" },
    );
    const { data: insertedTile } = await supabase
      .from("protected_asset_grid_tiles")
      .select("id")
      .eq("parent_asset_id", asset.id)
      .eq("tile_index", tileIndex)
      .maybeSingle();

    const tileId = insertedTile?.id ?? existingTile?.id;
    const tileStorageKey = `clients/${userId}/reference/screenshot-derived/${asset.id}/${tileIndex}.jpg`;

    try {
      await deps.uploadTileBytes(tileStorageKey, tileBytes);
      const promoted = await deps.promoteToReferenceFace({
        userId,
        profileId,
        tileBytes,
        tileStorageKey,
        sourceAssetId: asset.id,
        sourceTileId: tileId,
        faceConfidence: analysis.confidence,
        phash: candidatePhash,
      });

      await supabase
        .from("protected_asset_grid_tiles")
        .update({
          tile_storage_path: tileStorageKey,
          promotion_status: "AUTO_APPROVED",
          promoted_reference_id: promoted.referenceId,
        })
        .eq("id", tileId);

      promotedThisRun.push({
        id: promoted.referenceId,
        phash: candidatePhash,
        imageBytes: tileBytes,
      });
      counts.matched += 1;
    } catch (err) {
      console.error("[face-reference-extraction] promotion failed", asset.id, tileIndex, err);
      await supabase
        .from("protected_asset_grid_tiles")
        .update({ promotion_status: "PENDING_REVIEW" })
        .eq("id", tileId);
      counts.pendingReview += 1;
    }
  }

  await supabase
    .from("protected_assets")
    .update({
      grid_screenshot_status: "COMPLETED",
      grid_processed_at: new Date().toISOString(),
      grid_tile_count: tiles.length,
    })
    .eq("id", asset.id)
    .eq("user_id", userId);

  return { status: "COMPLETED", ...counts };
}
