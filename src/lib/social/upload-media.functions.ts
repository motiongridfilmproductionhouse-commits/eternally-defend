import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Manual upload fallback for MODE B.
 *
 * This is the path a customer uses when a platform (e.g. Instagram) blocks
 * anonymous retrieval of their own post. The bytes come from the customer, so
 * nothing is scraped and no credentials are ever requested. It ends in exactly
 * the same validated place as link import: owner-scoped protected asset,
 * pHash/dHash/aHash (or video keyframes), provenance, Autopilot enrollment.
 */

const MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/quicktime",
] as const;

const MAX_BYTES = 15 * 1024 * 1024;

export const prepareSocialMediaUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        fileName: z.string().min(1).max(180),
        contentType: z.enum(MEDIA_TYPES),
        size: z.number().int().positive().max(MAX_BYTES),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { getSignedPutUrl } = await import("@/lib/aws/s3.server");
    const safeName = data.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
    const key = `clients/${context.userId}/assets/social/upload-${crypto.randomUUID()}-${safeName}`;
    return { key, uploadUrl: await getSignedPutUrl(key, data.contentType, 600) };
  });

export const protectFromUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        key: z.string().min(10).max(500),
        name: z.string().min(1).max(200),
        contentType: z.enum(MEDIA_TYPES),
        /** Optional: the post this media was published as, for provenance only. */
        sourcePostUrl: z.string().max(600).optional(),
        socialAccountId: z.string().uuid().optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const { getBucket, getS3 } = await import("@/lib/aws/clients.server");
    const { ingestMediaBytes } = await import("./media-ingest.server");
    const { buildProvenance, handleFromProfileUrl, normalizeProfileUrl, parsePostUrl, platformFromUrl } =
      await import("./provenance");

    const prefix = `clients/${context.userId}/assets/social/`;
    if (!data.key.startsWith(prefix)) throw new Error("Invalid asset storage path.");

    const object = await getS3().send(new GetObjectCommand({ Bucket: getBucket(), Key: data.key }));
    const bytes = new Uint8Array(await object.Body!.transformToByteArray());
    if (!bytes.length || bytes.length > MAX_BYTES)
      throw new Error("Uploaded media is empty or too large.");

    const postUrl = data.sourcePostUrl ? normalizeProfileUrl(data.sourcePostUrl) : null;
    const parsed = postUrl ? parsePostUrl(postUrl) : null;
    const provenance = buildProvenance({
      platform: parsed?.platform ?? (postUrl ? platformFromUrl(postUrl) : "other"),
      importMethod: "MANUAL_UPLOAD",
      postUrl,
      postId: parsed?.postId ?? null,
      handle: postUrl ? handleFromProfileUrl(postUrl) : null,
      socialAccountId: data.socialAccountId ?? null,
    });

    const result = await ingestMediaBytes({
      supabase: context.supabase,
      userId: context.userId,
      name: data.name,
      bytes,
      contentType: data.contentType,
      provenance,
    });
    return { status: result.status, result };
  });
