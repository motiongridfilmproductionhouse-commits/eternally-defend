import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * MODE B / manual protection — "Protect from link".
 *
 * The customer pastes a permalink to their own public post. We read only the
 * platform's own public metadata; if the platform blocks anonymous access we
 * return a clear fallback instruction instead of attempting any workaround.
 */
export const protectFromLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        url: z.string().min(8).max(600),
        name: z.string().max(200).optional(),
        socialAccountId: z.string().uuid().optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { resolvePublicPostMedia } = await import("./public-post.server");
    const { ingestRemoteMedia } = await import("./media-ingest.server");
    const { buildProvenance, handleFromProfileUrl } = await import("./provenance");
    const { modeBLog, classifyReason } = await import("./observability");

    const resolved = await resolvePublicPostMedia(data.url);
    if (!resolved) throw new Error("That does not look like a valid post link.");
    if (resolved.blocked || !resolved.mediaUrls.length) {
      const reason = resolved.blockedReason ?? "no_public_media_metadata";
      modeBLog({ event: "public_retrieval_blocked", outcome: "platform_limit", platform: resolved.platform, reason, userId: context.userId });
      modeBLog({ event: "upload_required", outcome: "info", platform: resolved.platform, reason, userId: context.userId });
      return {
        status: "manual_upload_required" as const,
        platform: resolved.platform,
        reason: resolved.blockedReason ?? "no_public_media_metadata",
        message:
          "This platform does not make that post's media publicly readable. Upload the original file instead — protection is identical.",
        results: [],
      };
    }

    const baseName =
      data.name?.trim() ||
      resolved.title?.trim() ||
      `${resolved.platform} ${resolved.postId ?? "post"}`;

    const results = [];
    // A carousel post publishes several media items behind one permalink. Each
    // item becomes its own protected asset while provenance keeps the shared
    // post URL and the carousel position.
    const mediaItems = resolved.mediaUrls.slice(0, 10);
    const isCarousel = mediaItems.length > 1;
    for (const [index, mediaUrl] of mediaItems.entries()) {
      const provenance = buildProvenance({
        platform: resolved.platform,
        importMethod: "PUBLIC_LINK",
        postUrl: resolved.canonicalUrl,
        postId: resolved.postId,
        mediaUrl,
        carouselIndex: isCarousel ? index + 1 : null,
        handle: handleFromProfileUrl(resolved.canonicalUrl),
        socialAccountId: data.socialAccountId ?? null,
      });
      results.push(
        await ingestRemoteMedia({
          supabase: context.supabase,
          userId: context.userId,
          name: isCarousel ? `${baseName} (${index + 1})` : baseName,
          mediaUrl,
          provenance,
        }),
      );
    }


    for (const r of results) {
      modeBLog({
        event: r.status === "duplicate" ? "dedupe_hit" : "link_import",
        outcome: r.status === "skipped" ? classifyReason(r.reason) : "success",
        platform: resolved.platform,
        importMethod: "PUBLIC_LINK",
        reason: r.reason,
        userId: context.userId,
        assetId: r.asset_id,
        fingerprinted: r.fingerprinted,
        frames: r.frames,
      });
    }

    const created = results.filter((r) => r.status === "created").length;
    if (!created && results.every((r) => r.status === "skipped")) {
      modeBLog({ event: "upload_required", outcome: "platform_limit", platform: resolved.platform, reason: results[0]?.reason ?? "public_retrieval_blocked", userId: context.userId });
      return {
        status: "manual_upload_required" as const,
        platform: resolved.platform,
        reason: results[0]?.reason ?? "public_retrieval_blocked",
        message:
          "The media behind that link could not be retrieved publicly. Upload the original file instead — protection is identical.",
        results,
      };
    }

    return {
      status: "protected" as const,
      platform: resolved.platform,
      reason: null,
      message: null,
      results,
    };
  });
