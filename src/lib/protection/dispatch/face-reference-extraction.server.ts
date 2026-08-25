/**
 * Face Reference Extraction dispatch. Backfills approved secondary
 * (screenshot-derived) reference faces for an already-protected customer
 * from Instagram/social grid screenshots they've already uploaded as
 * protected_assets — never asks them to repeat onboarding or liveness.
 *
 * Identity anchor comes from the shared getTrustedFaceAnchorsForUser
 * resolver (src/lib/protection/trusted-face-anchors.server.ts), which
 * recognizes EITHER real production chain:
 *   1. Face Protection / AWS Liveness: protected_face_profiles.status =
 *      'FACE_VERIFIED' + ACTIVE protected_faces rows.
 *   2. Manual Deepfake Intel enrollment: deepfake_target_profiles ->
 *      deepfake_reference_faces.
 * A customer with neither gets an honest NO_VERIFIED_FACE_REFERENCE and
 * nothing runs — this never bootstraps trust from an unverified face.
 *
 * Promoted screenshot-derived references always land in
 * deepfake_reference_faces (tier SCREENSHOT_DERIVED_REFERENCE), same as
 * before — a liveness-only customer's first verified match lazily
 * find-or-creates the deepfake_target_profiles row that table's FK
 * requires (see ensureDeepfakeTargetProfileForUser), it never copies their
 * liveness face into deepfake_reference_faces.
 */
import {
  processProtectedAssetForFaceReferences,
  type ProtectedAssetRow,
  type PipelineDeps,
} from "../face-reference-extraction/pipeline.server";
import { detectGridTiles, cropTile } from "../face-reference-extraction/grid-detect.server";
import { analyzeTileForFace } from "../face-reference-extraction/tile-face-analysis.server";
import { matchTileAgainstReferences } from "../face-reference-extraction/identity-match.server";
import { computePerceptualHash, checkDuplicate } from "../face-reference-extraction/dedupe.server";
import {
  getTrustedFaceAnchorsForUser,
  hasTrustedAnchor,
  orderAnchorsByTrust,
  ensureDeepfakeTargetProfileForUser,
} from "../trusted-face-anchors.server";

export interface FaceReferenceExtractionOutcome {
  status: string;
  candidates_found: number;
  verified_findings: number;
  blocked_reason: string | null;
}

const ASSET_BATCH_SIZE = 5;
const MAX_REFERENCE_IMAGES = 5;

/**
 * Real network/AWS I/O, injectable so this dispatcher is unit-testable
 * against a mocked Supabase client without live AWS credentials — same
 * dependency-injection shape as DeepfakeDispatchDeps in dispatch/deepfake.server.ts.
 */
export interface FaceReferenceExtractionDispatchDeps {
  downloadAssetBytes?: (storagePath: string) => Promise<Uint8Array>;
  uploadTileBytes?: (key: string, bytes: Uint8Array) => Promise<void>;
  sha256?: (bytes: Uint8Array) => Promise<string>;
  downloadTrustedAnchorBytes?: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    anchor: any,
  ) => Promise<Uint8Array>;
  promoteToReferenceFace?: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabaseAdmin: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input: any,
  ) => Promise<{ referenceId: string }>;
  /** Pipeline algorithm layer (grid detection, face analysis, identity matching) — overridable so tests never need real sharp/Rekognition calls. */
  detectGrid?: PipelineDeps["detectGrid"];
  cropTile?: PipelineDeps["cropTile"];
  analyzeFace?: PipelineDeps["analyzeFace"];
  matchIdentity?: PipelineDeps["matchIdentity"];
  computePhash?: PipelineDeps["computePhash"];
  checkDuplicate?: PipelineDeps["checkDuplicate"];
}

export async function runFaceReferenceExtractionForUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  userId: string,
  deps: FaceReferenceExtractionDispatchDeps = {},
): Promise<FaceReferenceExtractionOutcome> {
  const io = await import("./face-reference-extraction-io.server");
  const downloadAssetBytes = deps.downloadAssetBytes ?? io.downloadAssetBytes;
  const uploadTileBytes = deps.uploadTileBytes ?? io.uploadTileBytes;
  const sha256 = deps.sha256 ?? io.sha256;
  const downloadTrustedAnchorBytes =
    deps.downloadTrustedAnchorBytes ?? io.downloadTrustedAnchorBytes;
  const promoteToReferenceFace = deps.promoteToReferenceFace ?? io.promoteToReferenceFace;
  const detectGrid = deps.detectGrid ?? detectGridTiles;
  const doCropTile = deps.cropTile ?? cropTile;
  const analyzeFace = deps.analyzeFace ?? analyzeTileForFace;
  const matchIdentity = deps.matchIdentity ?? matchTileAgainstReferences;
  const computePhash = deps.computePhash ?? computePerceptualHash;
  const doCheckDuplicate = deps.checkDuplicate ?? checkDuplicate;

  const anchorResult = await getTrustedFaceAnchorsForUser(supabaseAdmin, userId);
  if (!hasTrustedAnchor(anchorResult)) {
    return {
      status: "WAITING_FOR_NEXT_SCAN",
      candidates_found: 0,
      verified_findings: 0,
      blocked_reason: "NO_VERIFIED_FACE_REFERENCE",
    };
  }

  const orderedAnchors = orderAnchorsByTrust(anchorResult.anchors).slice(0, MAX_REFERENCE_IMAGES);

  // Dedup candidates are only the already-promoted deepfake_reference_faces
  // rows (they're the ones a repeat screenshot could actually duplicate) —
  // fetch their phash alongside, gated on a target profile actually existing.
  const phashByReferenceId = new Map<string, string | null>();
  if (anchorResult.deepfakeTargetProfileId) {
    const { data: refRows } = await supabaseAdmin
      .from("deepfake_reference_faces")
      .select("id, phash")
      .eq("profile_id", anchorResult.deepfakeTargetProfileId);
    for (const row of (refRows ?? []) as Array<{ id: string; phash: string | null }>) {
      phashByReferenceId.set(row.id, row.phash ?? null);
    }
  }

  const referenceImages: Uint8Array[] = [];
  // Parallel to referenceImages — the deepfake_reference_faces id each entry
  // came from, so a new match's promotion can record which specific
  // reference it was compared against (revocation cascades walk this edge).
  // A FACE_PROTECTION (liveness) anchor's referenceId is a protected_faces
  // id, not a deepfake_reference_faces row, so it's recorded as null here —
  // there's nothing in this table to cascade a revocation from.
  const referenceIds: Array<string | null> = [];
  const existingReferences: Array<{ id: string; phash: string | null; imageBytes: Uint8Array }> =
    [];
  for (const anchor of orderedAnchors) {
    try {
      const bytes = await downloadTrustedAnchorBytes(supabaseAdmin, anchor);
      referenceImages.push(bytes);
      referenceIds.push(anchor.source === "DEEPFAKE_PROFILE" ? anchor.referenceId : null);
      if (anchor.source === "DEEPFAKE_PROFILE") {
        existingReferences.push({
          id: anchor.referenceId,
          phash: phashByReferenceId.get(anchor.referenceId) ?? null,
          imageBytes: bytes,
        });
      }
    } catch (err) {
      console.warn("[face-reference-extraction] failed to load trusted anchor", anchor.source, err);
    }
  }

  if (referenceImages.length === 0) {
    return {
      status: "WAITING_FOR_NEXT_SCAN",
      candidates_found: 0,
      verified_findings: 0,
      blocked_reason: "NO_VERIFIED_FACE_REFERENCE",
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

  // Lazily find-or-create the deepfake_target_profiles row only at the
  // moment a real >=95% match needs somewhere to be promoted to — resolved
  // at most once per run (cached), and reused across every subsequent tile
  // and asset in this same run once resolved.
  let resolvedProfileId = anchorResult.deepfakeTargetProfileId;
  let profileResolution: Promise<string> | null = null;
  const resolveProfileIdForPromotion = (): Promise<string> => {
    if (resolvedProfileId) return Promise.resolve(resolvedProfileId);
    if (!profileResolution) {
      profileResolution = (async () => {
        const { data: profileRow } = await supabaseAdmin
          .from("protection_profiles")
          .select("display_name, verified_name")
          .eq("user_id", userId)
          .maybeSingle();
        const targetName =
          (profileRow?.display_name || profileRow?.verified_name || "").trim() ||
          "Protected Subject";
        const id = await ensureDeepfakeTargetProfileForUser(supabaseAdmin, userId, targetName);
        resolvedProfileId = id;
        return id;
      })();
    }
    return profileResolution;
  };

  let candidatesFound = 0;
  let verifiedFindings = 0;
  let anyFailed = false;

  for (const asset of assets) {
    try {
      const outcome = await processProtectedAssetForFaceReferences({
        supabase: supabaseAdmin,
        userId,
        profileId: resolvedProfileId,
        asset,
        referenceImages,
        referenceIds,
        existingReferences,
        deps: {
          downloadAssetBytes: (storagePath) => downloadAssetBytes(storagePath),
          uploadTileBytes: (key, bytes) => uploadTileBytes(key, bytes),
          sha256,
          detectGrid,
          cropTile: doCropTile,
          analyzeFace,
          matchIdentity,
          computePhash,
          checkDuplicate: doCheckDuplicate,
          promoteToReferenceFace: async (input) => {
            const profileId = input.profileId ?? (await resolveProfileIdForPromotion());
            return promoteToReferenceFace(supabaseAdmin, { ...input, profileId });
          },
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
