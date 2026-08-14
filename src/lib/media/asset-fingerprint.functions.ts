import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getSignedGetUrl, getSignedPutUrl } from "@/lib/aws/s3.server";
import {
  HASH_ALGORITHM,
  fingerprintImageObject,
  isRealPerceptualHash,
} from "./asset-fingerprint.server";
import {
  extractVideoFrames,
  frameRowsForAsset,
  videoFrameExtractionConfigured,
} from "./video-frames.server";

const videoTypes = ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"] as const;

/** Signed upload slot for a protected video asset. */
export const prepareVideoUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        fileName: z.string().min(1).max(180),
        contentType: z.enum(videoTypes),
        size: z
          .number()
          .int()
          .positive()
          .max(500 * 1024 * 1024),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const safeName = data.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
    const key = `clients/${context.userId}/assets/${crypto.randomUUID()}-${safeName}`;
    return { key, uploadUrl: await getSignedPutUrl(key, data.contentType, 900) };
  });

/** Register an uploaded video and persist real per-frame perceptual hashes. */
export const registerVideoAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        key: z.string().min(10).max(500),
        name: z.string().min(1).max(200),
        contentType: z.enum(videoTypes),
        sourceUrl: z.string().url().optional().or(z.literal("")),
        maxFrames: z.number().int().min(4).max(120).default(40),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    if (!data.key.startsWith(`clients/${context.userId}/assets/`)) {
      throw new Error("Invalid asset storage path.");
    }
    if (!videoFrameExtractionConfigured()) {
      throw new Error("Video fingerprinting service is not configured (CRAWLER_SERVICE_URL).");
    }

    const signedUrl = await getSignedGetUrl(data.key, 1800);
    const extraction = await extractVideoFrames(signedUrl, { maxFrames: data.maxFrames });

    const { data: inserted, error } = await context.supabase
      .from("protected_assets")
      .insert({
        user_id: context.userId,
        name: data.name.trim(),
        kind: "video",
        source_url: data.sourceUrl || null,
        storage_path: data.key,
        active: true,
        // Representative frame hash so single-hash lookups still work.
        phash: extraction.frames[0]?.phash ?? null,
        dhash: extraction.frames[0]?.dhash ?? null,
        ahash: extraction.frames[0]?.ahash ?? null,
        hash_algorithm: "video_frames:phash+dhash+ahash",
        hashed_at: new Date().toISOString(),
        metadata: {
          status: "Monitoring",
          content_type: data.contentType,
          video: {
            fps: extraction.fps,
            duration_seconds: extraction.durationSeconds,
            total_frames: extraction.totalFrames,
            sampled_frames: extraction.sampledFrames,
            stride_frames: extraction.strideFrames,
            algorithms: extraction.algorithms,
          },
        },
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const rows = frameRowsForAsset(context.userId, inserted.id, extraction);
    const { error: frameError } = await context.supabase.from("protected_asset_frames").insert(rows);
    if (frameError) throw new Error(frameError.message);

    return {
      id: inserted.id,
      framesStored: rows.length,
      durationSeconds: extraction.durationSeconds,
      fps: extraction.fps,
    };
  });

/**
 * Backfill real perceptual hashes for the caller's own image assets that were
 * stored before real hashing existed (legacy md5/sha256-prefix values).
 */
export const backfillAssetFingerprints = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ limit: z.number().int().min(1).max(50).default(20) }).parse(raw))
  .handler(async ({ data, context }) => {
    const { data: assets, error } = await context.supabase
      .from("protected_assets")
      .select("id, storage_path, phash, kind, hash_algorithm")
      .eq("user_id", context.userId)
      .not("storage_path", "is", null)
      .limit(200);
    if (error) throw new Error(error.message);

    const pending = (assets ?? [])
      .filter((asset) => asset.kind !== "video")
      .filter((asset) => asset.hash_algorithm !== HASH_ALGORITHM || !isRealPerceptualHash(asset.phash))
      .slice(0, data.limit);

    let updated = 0;
    const failures: Array<{ id: string; reason: string }> = [];
    for (const asset of pending) {
      try {
        const { hashes } = await fingerprintImageObject(asset.storage_path as string);
        if (!hashes) {
          failures.push({ id: asset.id, reason: "undecodable image format" });
          continue;
        }
        const { error: updateError } = await context.supabase
          .from("protected_assets")
          .update({
            phash: hashes.phash,
            dhash: hashes.dhash,
            ahash: hashes.ahash,
            hash_algorithm: HASH_ALGORITHM,
            hashed_at: new Date().toISOString(),
          })
          .eq("id", asset.id)
          .eq("user_id", context.userId);
        if (updateError) throw new Error(updateError.message);
        updated += 1;
      } catch (err) {
        failures.push({ id: asset.id, reason: (err as Error).message });
      }
    }

    return { candidates: pending.length, updated, failures };
  });
