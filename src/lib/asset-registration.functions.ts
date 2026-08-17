import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createHash } from "node:crypto";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getBucket, getS3 } from "@/lib/aws/clients.server";
import { getSignedGetUrl, getSignedPutUrl } from "@/lib/aws/s3.server";
import { computePerceptualHashes } from "@/lib/media/perceptual-hash.server";
import { reverseSearchAndVerify } from "@/lib/assets/reverse-verify.server";
import { enrollAssetInAutopilot } from "@/lib/protection/enroll-asset.server";
import { buildProvenance, platformFromUrl } from "@/lib/social/provenance";

const imageTypes = ["image/jpeg", "image/png", "image/webp"] as const;

export const prepareAssetUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        fileName: z.string().min(1).max(180),
        contentType: z.enum(imageTypes),
        size: z
          .number()
          .int()
          .positive()
          .max(10 * 1024 * 1024),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const safeName = data.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
    const key = `clients/${context.userId}/assets/${crypto.randomUUID()}-${safeName}`;
    return { key, uploadUrl: await getSignedPutUrl(key, data.contentType, 300) };
  });


export const registerAssetAndSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        key: z.string().min(10).max(500),
        name: z.string().min(1).max(200),
        platform: z.string().max(100).optional(),
        sourceUrl: z.string().url().optional().or(z.literal("")),
        contentType: z.enum(imageTypes),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const prefix = `clients/${context.userId}/assets/`;
    if (!data.key.startsWith(prefix)) throw new Error("Invalid asset storage path.");
    const object = await getS3().send(new GetObjectCommand({ Bucket: getBucket(), Key: data.key }));
    const bytes = new Uint8Array(await object.Body!.transformToByteArray());
    if (!bytes.length || bytes.length > 10 * 1024 * 1024)
      throw new Error("Uploaded image is empty or too large.");
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    // Real perceptual fingerprint (pHash/dHash/aHash) — persisted so every later
    // scan can verify candidates without re-downloading the original.
    const hashes = computePerceptualHashes(bytes);

    const signedImageUrl = await getSignedGetUrl(data.key, 600);
    // Reverse discovery is best-effort: provider quota/outage must never block
    // protecting the asset. The asset is still fingerprinted and enrolled, and
    // recurring scans retry discovery later.
    let reverse: Awaited<ReturnType<typeof reverseSearchAndVerify>> | null = null;
    let reverseError: string | null = null;
    try {
      reverse = await reverseSearchAndVerify(
        signedImageUrl,
        data.name.trim(),
        bytes,
        { phash: hashes?.phash ?? null, dhash: hashes?.dhash ?? null, ahash: hashes?.ahash ?? null },
        sha256,
      );
    } catch (error) {
      reverseError = error instanceof Error ? error.message : "reverse discovery unavailable";
      console.error("[asset_registration] reverse discovery skipped:", reverseError);
    }
    const matchCount = reverse
      ? reverse.pages.length +
        reverse.fullMatchingImages.length +
        reverse.partialMatchingImages.length
      : 0;

    const { data: inserted, error } = await context.supabase
      .from("protected_assets")
      .insert({
        user_id: context.userId,
        name: data.name.trim(),
        kind: "photo",
        source_url: data.sourceUrl || null,
        storage_path: data.key,
        active: true,
        phash: hashes?.phash ?? null,
        dhash: hashes?.dhash ?? null,
        ahash: hashes?.ahash ?? null,
        hash_algorithm: hashes ? "phash64_dct32+dhash64+ahash64" : null,
        hashed_at: hashes ? new Date().toISOString() : null,
        metadata: {
          platform: data.platform || null,
          status: "Monitoring",
          content_type: data.contentType,
          sha256,
          perceptual_hashes: hashes ? { ...hashes } : null,
          reverse_search: reverse,
          reverse_search_match_count: matchCount,
          reverse_search_at: new Date().toISOString(),
          reverse_search_provider: "reverse_image_router",
          provenance: buildProvenance({
            platform: data.sourceUrl ? platformFromUrl(data.sourceUrl) : "other",
            importMethod: "MANUAL_UPLOAD",
            postUrl: data.sourceUrl || null,
          }),
        },
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    // Newly fingerprinted assets join continuous protection immediately when the
    // account already has an active protection profile.
    const enrollment = await enrollAssetInAutopilot(context.supabase, context.userId, {
      id: inserted.id,
      name: data.name.trim(),
      phash: hashes?.phash ?? null,
      dhash: hashes?.dhash ?? null,
      ahash: hashes?.ahash ?? null,
    });

    return { id: inserted.id, enrollment, sha256, phash: hashes?.phash ?? null, matchCount, reverse };
  });

