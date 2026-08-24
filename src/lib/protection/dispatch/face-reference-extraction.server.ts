/**
 * Face Reference Extraction dispatch. Backfills approved secondary
 * (screenshot-derived) reference faces for an already-protected customer
 * from Instagram/social grid screenshots they've already uploaded as
 * protected_assets — never asks them to repeat onboarding or liveness.
 *
 * Uses the same confirmed-real, strictly-anchored identity chain as
 * dispatch/deepfake.server.ts: user_id -> deepfake_target_profiles ->
 * deepfake_reference_faces. If a customer has no target profile or zero
 * existing reference faces, there is nothing to anchor identity to — this
 * returns an honest blocked status and processes nothing, exactly like
 * Deepfake Intel does, rather than fabricating an anchor.
 */
import { findExistingDeepfakeTarget } from "./deepfake.server";
import {
  processProtectedAssetForFaceReferences,
  type ProtectedAssetRow,
} from "../face-reference-extraction/pipeline.server";
import { detectGridTiles, cropTile } from "../face-reference-extraction/grid-detect.server";
import { analyzeTileForFace } from "../face-reference-extraction/tile-face-analysis.server";
import { matchTileAgainstReferences } from "../face-reference-extraction/identity-match.server";
import { computePerceptualHash, checkDuplicate } from "../face-reference-extraction/dedupe.server";

export interface FaceReferenceExtractionOutcome {
  status: string;
  candidates_found: number;
  verified_findings: number;
  blocked_reason: string | null;
}

const ASSET_BATCH_SIZE = 5;
const MAX_REFERENCE_IMAGES = 5;

export async function runFaceReferenceExtractionForUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  userId: string,
): Promise<FaceReferenceExtractionOutcome> {
  const {
    downloadAssetBytes,
    uploadTileBytes,
    sha256,
    downloadReferenceImageBytes,
    promoteToReferenceFace,
  } = await import("./face-reference-extraction-io.server");

  const existing = await findExistingDeepfakeTarget(supabaseAdmin, userId);
  if (!existing) {
    return {
      status: "WAITING_FOR_NEXT_SCAN",
      candidates_found: 0,
      verified_findings: 0,
      blocked_reason: "NO_TARGET_PROFILE",
    };
  }
  if (existing.referenceFaceCount === 0) {
    return {
      status: "WAITING_FOR_NEXT_SCAN",
      candidates_found: 0,
      verified_findings: 0,
      blocked_reason: "NO_REFERENCE_FACES",
    };
  }

  const { data: referenceRows } = await supabaseAdmin
    .from("deepfake_reference_faces")
    .select("id, storage_path, phash, reference_tier")
    .eq("profile_id", existing.profileId);

  // Prefer the canonical verified/liveness reference if one ever exists,
  // then already-approved references, before the batch we're loading up to
  // MAX_REFERENCE_IMAGES from. Never relies on alphabetical column sort.
  const TIER_PRIORITY: Record<string, number> = {
    CANONICAL_VERIFIED_REFERENCE: 0,
    APPROVED_SECONDARY_REFERENCE: 1,
    SCREENSHOT_DERIVED_REFERENCE: 2,
  };
  const orderedReferenceRows = [...(referenceRows ?? [])]
    .sort((a, b) => (TIER_PRIORITY[a.reference_tier] ?? 1) - (TIER_PRIORITY[b.reference_tier] ?? 1))
    .slice(0, MAX_REFERENCE_IMAGES);

  const referenceImages: Uint8Array[] = [];
  const existingReferences: Array<{ id: string; phash: string | null; imageBytes: Uint8Array }> =
    [];
  for (const row of orderedReferenceRows) {
    if (!row.storage_path) continue;
    try {
      const bytes = await downloadReferenceImageBytes(supabaseAdmin, row.storage_path);
      referenceImages.push(bytes);
      existingReferences.push({ id: row.id, phash: row.phash ?? null, imageBytes: bytes });
    } catch (err) {
      console.warn("[face-reference-extraction] failed to load reference image", row.id, err);
    }
  }

  if (referenceImages.length === 0) {
    return {
      status: "WAITING_FOR_NEXT_SCAN",
      candidates_found: 0,
      verified_findings: 0,
      blocked_reason: "NO_REFERENCE_FACES",
    };
  }

  const { data: pendingAssets } = await supabaseAdmin
    .from("protected_assets")
    .select("id, user_id, storage_path, created_at, grid_screenshot_status, metadata")
    .eq("user_id", userId)
    .eq("kind", "photo")
    .in("grid_screenshot_status", ["UNSCREENED", "PENDING"])
    .order("created_at", { ascending: true })
    .limit(ASSET_BATCH_SIZE);

  const assets = (pendingAssets ?? []) as ProtectedAssetRow[];
  if (assets.length === 0) {
    return {
      status: "WAITING_FOR_NEXT_SCAN",
      candidates_found: 0,
      verified_findings: 0,
      blocked_reason: null,
    };
  }

  let candidatesFound = 0;
  let verifiedFindings = 0;
  let anyFailed = false;

  for (const asset of assets) {
    try {
      const outcome = await processProtectedAssetForFaceReferences({
        supabase: supabaseAdmin,
        userId,
        profileId: existing.profileId,
        asset,
        referenceImages,
        existingReferences,
        deps: {
          downloadAssetBytes: (storagePath) => downloadAssetBytes(storagePath),
          uploadTileBytes: (key, bytes) => uploadTileBytes(key, bytes),
          sha256,
          detectGrid: detectGridTiles,
          cropTile,
          analyzeFace: analyzeTileForFace,
          matchIdentity: matchTileAgainstReferences,
          computePhash: computePerceptualHash,
          checkDuplicate,
          promoteToReferenceFace: (input) => promoteToReferenceFace(supabaseAdmin, input),
        },
      });
      candidatesFound += outcome.usableFaces;
      verifiedFindings += outcome.matched;
      if (outcome.status === "FAILED") anyFailed = true;
    } catch (err) {
      console.error("[face-reference-extraction] asset processing failed", asset.id, err);
      anyFailed = true;
    }
  }

  return {
    status: anyFailed ? "PARTIAL" : "COMPLETED",
    candidates_found: candidatesFound,
    verified_findings: verifiedFindings,
    blocked_reason: null,
  };
}
