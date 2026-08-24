/**
 * Customer-facing server functions for the Command Center's "Face Reference
 * Coverage" panel and its "View References" drill-down. Everything here is
 * strictly scoped to the authenticated user — a customer can only ever see
 * their own screenshots, tiles, and reference faces. Never returns
 * `rekognition_face_id`, Rekognition collection ids, or bounding-box vectors
 * to the client — those stay server-side.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function findTargetProfileId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("deepfake_target_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.id ?? null;
}

export interface FaceReferenceCoverage {
  verifiedReferenceCount: number;
  approvedSecondaryReferenceCount: number;
  tilesAnalyzed: number;
  facesDetected: number;
  matched: number;
  rejectedOrReview: number;
}

export const getFaceReferenceCoverage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FaceReferenceCoverage> => {
    const { userId } = context;
    // protected_asset_grid_tiles and the new deepfake_reference_faces
    // columns are not yet reflected in the generated Database type until the
    // migration is applied and types are regenerated — cast, matching this
    // codebase's existing convention for tables ahead of codegen (see
    // src/lib/enforcement/worker.ts).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = context.supabase as any;
    const profileId = await findTargetProfileId(supabase, userId);

    if (!profileId) {
      return {
        verifiedReferenceCount: 0,
        approvedSecondaryReferenceCount: 0,
        tilesAnalyzed: 0,
        facesDetected: 0,
        matched: 0,
        rejectedOrReview: 0,
      };
    }

    const [
      { data: referenceRows },
      { count: tilesAnalyzed },
      { count: facesDetected },
      { count: matched },
    ] = await Promise.all([
      supabase
        .from("deepfake_reference_faces")
        .select("reference_tier")
        .eq("profile_id", profileId),
      supabase
        .from("protected_asset_grid_tiles")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId),
      supabase
        .from("protected_asset_grid_tiles")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("face_classification", "USABLE_FACE"),
      supabase
        .from("protected_asset_grid_tiles")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .in("promotion_status", ["AUTO_APPROVED", "MANUALLY_APPROVED"]),
    ]);

    const rows = (referenceRows ?? []) as Array<{ reference_tier: string }>;
    const verifiedReferenceCount = rows.filter(
      (r) => r.reference_tier === "CANONICAL_VERIFIED_REFERENCE",
    ).length;
    const approvedSecondaryReferenceCount = rows.filter(
      (r) => r.reference_tier !== "CANONICAL_VERIFIED_REFERENCE",
    ).length;

    const facesDetectedCount = facesDetected ?? 0;
    const matchedCount = matched ?? 0;

    return {
      verifiedReferenceCount,
      approvedSecondaryReferenceCount,
      tilesAnalyzed: tilesAnalyzed ?? 0,
      facesDetected: facesDetectedCount,
      matched: matchedCount,
      rejectedOrReview: Math.max(0, facesDetectedCount - matchedCount),
    };
  });

const ListDetailInput = z.object({
  limit: z.number().int().min(1).max(100).default(50),
});

export interface FaceReferenceTileDetail {
  id: string;
  parentAssetId: string;
  tileIndex: number;
  faceClassification: string;
  identityStatus: string | null;
  faceMatchSimilarity: number | null;
  promotionStatus: string;
  capturedAt: string;
  screenshotSignedUrl: string | null;
  tileSignedUrl: string | null;
}

export const listFaceReferenceDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ListDetailInput.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<FaceReferenceTileDetail[]> => {
    const { userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = context.supabase as any;
    const { data: tiles, error } = await supabase
      .from("protected_asset_grid_tiles")
      .select(
        "id, parent_asset_id, tile_index, face_classification, identity_status, face_match_similarity, promotion_status, captured_at, tile_storage_path",
      )
      .eq("user_id", userId)
      .neq("promotion_status", "NOT_CANDIDATE")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);

    const rows = tiles ?? [];
    if (rows.length === 0) return [];

    const assetIds = Array.from(
      new Set(rows.map((r: { parent_asset_id: string }) => r.parent_asset_id)),
    );
    const { data: assets } = await supabase
      .from("protected_assets")
      .select("id, storage_path")
      .eq("user_id", userId)
      .in("id", assetIds);
    const assetById = new Map(
      (assets ?? []).map((a: { id: string; storage_path: string | null }) => [a.id, a]),
    );

    const { getSignedGetUrl } = await import("@/lib/aws/s3.server");

    const results: FaceReferenceTileDetail[] = [];
    for (const tile of rows as Array<{
      id: string;
      parent_asset_id: string;
      tile_index: number;
      face_classification: string;
      identity_status: string | null;
      face_match_similarity: number | null;
      promotion_status: string;
      captured_at: string;
      tile_storage_path: string | null;
    }>) {
      const asset = assetById.get(tile.parent_asset_id) as
        { storage_path: string | null } | undefined;
      let screenshotSignedUrl: string | null = null;
      let tileSignedUrl: string | null = null;
      try {
        if (asset?.storage_path)
          screenshotSignedUrl = await getSignedGetUrl(asset.storage_path, 300);
        if (tile.tile_storage_path)
          tileSignedUrl = await getSignedGetUrl(tile.tile_storage_path, 300);
      } catch {
        // Signed URL generation failing shouldn't drop the row from the review queue.
      }
      results.push({
        id: tile.id,
        parentAssetId: tile.parent_asset_id,
        tileIndex: tile.tile_index,
        faceClassification: tile.face_classification,
        identityStatus: tile.identity_status,
        faceMatchSimilarity: tile.face_match_similarity,
        promotionStatus: tile.promotion_status,
        capturedAt: tile.captured_at,
        screenshotSignedUrl,
        tileSignedUrl,
      });
    }
    return results;
  });

const ReviewInput = z.object({
  tileId: z.string().uuid(),
  decision: z.enum(["approve", "reject"]),
});

export const reviewFaceReferenceCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ReviewInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = context.supabase as any;
    const { data: tile, error } = await supabase
      .from("protected_asset_grid_tiles")
      .select(
        "id, parent_asset_id, tile_index, promotion_status, tile_storage_path, face_confidence",
      )
      .eq("id", data.tileId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!tile) throw new Error("Reference candidate not found.");
    if (tile.promotion_status !== "PENDING_REVIEW") {
      throw new Error("This candidate has already been reviewed.");
    }

    if (data.decision === "reject") {
      await supabase
        .from("protected_asset_grid_tiles")
        .update({
          promotion_status: "REJECTED",
          reviewed_by: userId,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", data.tileId)
        .eq("user_id", userId);
      return { ok: true, decision: "reject" as const };
    }

    const profileId = await findTargetProfileId(supabase, userId);
    if (!profileId) throw new Error("No protected identity profile found for approval.");
    if (!tile.tile_storage_path) throw new Error("Tile image is missing — cannot approve.");

    const { getS3, getBucket } = await import("@/lib/aws/clients.server");
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const { computePerceptualHash, checkDuplicate } =
      await import("./face-reference-extraction/dedupe.server");
    const { promoteToReferenceFace } =
      await import("./dispatch/face-reference-extraction-io.server");

    const object = await getS3().send(
      new GetObjectCommand({ Bucket: getBucket(), Key: tile.tile_storage_path }),
    );
    if (!object.Body) throw new Error("Tile image could not be loaded.");
    const tileBytes = new Uint8Array(await object.Body.transformToByteArray());

    const { data: existingRefRows } = await supabase
      .from("deepfake_reference_faces")
      .select("id, storage_path, phash")
      .eq("profile_id", profileId);

    const existingReferences = [];
    for (const row of existingRefRows ?? []) {
      if (!row.storage_path) continue;
      try {
        const { data: file } = await supabase.storage
          .from("deepfake-reference-faces")
          .download(row.storage_path);
        if (!file) continue;
        const bytes = new Uint8Array(await file.arrayBuffer());
        existingReferences.push({ id: row.id, phash: row.phash ?? null, imageBytes: bytes });
      } catch {
        continue;
      }
    }

    const candidatePhash = await computePerceptualHash(tileBytes);
    const dedupe = await checkDuplicate({
      candidateBytes: tileBytes,
      candidatePhash,
      existingReferences,
    });

    if (dedupe.isDuplicate) {
      await supabase
        .from("protected_asset_grid_tiles")
        .update({
          promotion_status: "DUPLICATE",
          matched_reference_face_id: dedupe.duplicateOfReferenceId,
          reviewed_by: userId,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", data.tileId)
        .eq("user_id", userId);
      return { ok: true, decision: "reject" as const, reason: "duplicate" as const };
    }

    const promoted = await promoteToReferenceFace(supabase, {
      userId,
      profileId,
      tileBytes,
      tileStorageKey: tile.tile_storage_path,
      sourceAssetId: tile.parent_asset_id,
      sourceTileId: tile.id,
      faceConfidence: tile.face_confidence ?? null,
      phash: candidatePhash,
    });

    await supabase
      .from("protected_asset_grid_tiles")
      .update({
        promotion_status: "MANUALLY_APPROVED",
        promoted_reference_id: promoted.referenceId,
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", data.tileId)
      .eq("user_id", userId);

    return { ok: true, decision: "approve" as const };
  });
