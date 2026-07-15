/**
 * Server-only helper (not a server fn wrapper) so scan pipelines can invoke
 * face analysis without going through the RPC boundary.
 *
 * Best-effort: never throws — failures return { ok: false, reason }.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { youtubeThumbFromUrl, isValidImageUrl } from "@/lib/media-utils";

type Supa = SupabaseClient<Database>;

export async function analyzeHitForFaces(opts: {
  supabase: Supa;
  userId: string;
  scanHitId: string;
  imageUrl: string;
  sourceType: "youtube_thumb" | "profile" | "news" | "website" | "screenshot" | "other";
}): Promise<{ ok: boolean; matches?: number; reason?: string }> {
  try {
    const { data: col } = await opts.supabase
      .from("rekognition_collections").select("collection_id").eq("user_id", opts.userId).maybeSingle();
    if (!col?.collection_id) return { ok: false, reason: "no_collection" };

    const { fetchImageBytes, putObject, getBucket } = await import("./aws/s3.server");
    const { searchFacesByImage } = await import("./aws/rekognition.server");

    const img = await fetchImageBytes(opts.imageUrl);
    if (!img) return { ok: false, reason: "fetch_failed" };

    const { matches, searchedFaceConfidence, searchedFaceBoundingBox } = await searchFacesByImage({
      collectionId: col.collection_id, bytes: img.bytes, threshold: 80, maxFaces: 5,
    });
    if (matches.length === 0) return { ok: true, matches: 0 };

    const now = new Date();
    const key = `clients/${opts.userId}/scan-images/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}`;
    const bucket = getBucket();
    try { await putObject({ key, body: img.bytes, contentType: img.contentType }); } catch { /* ignore */ }

    const faceIds = matches.map((m) => m.faceId);
    const { data: prot } = await opts.supabase
      .from("protected_faces").select("id,face_id,asset_id").in("face_id", faceIds).eq("user_id", opts.userId);
    const byFace = new Map((prot ?? []).map((p) => [p.face_id, p]));

    for (const m of matches) {
      const pf = byFace.get(m.faceId);
      await opts.supabase.from("face_match_events").insert({
        user_id: opts.userId,
        collection_id: col.collection_id,
        matched_face_id: m.faceId,
        matched_protected_face_id: pf?.id ?? null,
        matched_asset_id: pf?.asset_id ?? null,
        similarity: m.similarity,
        face_confidence: searchedFaceConfidence ?? null,
        source_url: opts.imageUrl,
        source_type: opts.sourceType,
        scan_hit_id: opts.scanHitId,
        image_s3_bucket: bucket,
        image_s3_key: key,
        bounding_box: (searchedFaceBoundingBox as never) ?? null,
        review_status: "pending",
      });
    }
    return { ok: true, matches: matches.length };
  } catch (e) {
    console.warn("[face-scan] analyzeHit failed", (e as Error).message);
    return { ok: false, reason: (e as Error).message };
  }
}

export function pickScanImageUrl(hit: { thumbnail_url?: string | null; permalink?: string | null; canonical_url?: string | null; source?: string | null }): { url: string; type: "youtube_thumb" | "profile" | "news" | "website" | "screenshot" | "other" } | null {
  const yt = youtubeThumbFromUrl(hit.permalink) ?? youtubeThumbFromUrl(hit.canonical_url);
  if (yt) return { url: yt, type: "youtube_thumb" };
  if (isValidImageUrl(hit.thumbnail_url)) {
    const t = (hit.source ?? "").toLowerCase().includes("news") ? "news" : "website";
    return { url: hit.thumbnail_url!, type: t };
  }
  return null;
}
