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

    const resolved = await resolvePublicPostMedia(data.url);
    if (!resolved) throw new Error("That does not look like a valid post link.");
    if (resolved.blocked || !resolved.mediaUrls.length) {
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
    for (const [index, mediaUrl] of resolved.mediaUrls.slice(0, 5).entries()) {
      const provenance = buildProvenance({
        platform: resolved.platform,
        importMethod: "PUBLIC_LINK",
        postUrl: resolved.canonicalUrl,
        postId: resolved.postId,
        mediaUrl,
        handle: handleFromProfileUrl(resolved.canonicalUrl),
        socialAccountId: data.socialAccountId ?? null,
      });
      results.push(
        await ingestRemoteMedia({
          supabase: context.supabase,
          userId: context.userId,
          name: index === 0 ? baseName : `${baseName} (${index + 1})`,
          mediaUrl,
          provenance,
        }),
      );
    }

    const created = results.filter((r) => r.status === "created").length;
    if (!created && results.every((r) => r.status === "skipped")) {
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
