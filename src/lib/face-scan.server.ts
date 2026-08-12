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
    // Reuse the SAME enrolled protected-face registry as onboarding.
    const { resolveActiveFaceMonitoring } = await import(
      "./face-protection/monitoring.server"
    );
    const monitoring = await resolveActiveFaceMonitoring(
      opts.supabase as never,
      opts.userId,
    );
    const collectionId = monitoring.collectionId;
    if (!collectionId) return { ok: false, reason: "no_collection" };
    if (monitoring.activeFaces.length === 0) return { ok: false, reason: "no_active_faces" };

    const { fetchImageBytes, putObject, getBucket } = await import("./aws/s3.server");
    const { searchFacesByImage } = await import("./aws/rekognition.server");

    const img = await fetchImageBytes(opts.imageUrl);
    if (!img) return { ok: false, reason: "fetch_failed" };

    const { matches, searchedFaceConfidence, searchedFaceBoundingBox } = await searchFacesByImage({
      collectionId,
      bytes: img.bytes,
      threshold: 80,
      maxFaces: 5,
    });
    if (matches.length === 0) return { ok: true, matches: 0 };

    const now = new Date();
    const key = `clients/${opts.userId}/scan-images/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}`;
    const bucket = getBucket();
    try {
      await putObject({ key, body: img.bytes, contentType: img.contentType });
    } catch {
      /* ignore */
    }

    // Only accept matches against this user's ACTIVE protected faces.
    const activeIds = new Set(monitoring.activeFaceIds);
    const accepted = matches.filter((m) => activeIds.has(m.faceId));
    if (accepted.length === 0) return { ok: true, matches: 0 };

    const faceIds = accepted.map((m) => m.faceId);
    const { data: prot } = await opts.supabase
      .from("protected_faces")
      .select("id,face_id,asset_id")
      .in("face_id", faceIds)
      .eq("user_id", opts.userId);
    const byFace = new Map((prot ?? []).map((p) => [p.face_id, p]));

    // Existing-evidence context used ONLY to categorise a real match.
    const { classifyFaceLinkedFinding } = await import(
      "./face-protection/face-linked-category"
    );
    const [{ data: hitRow }, { data: dfRow }, { data: existing }] = await Promise.all([
      opts.supabase
        .from("scan_hits")
        .select("severity,risk_type,tags,threat_score")
        .eq("id", opts.scanHitId)
        .maybeSingle(),
      opts.supabase
        .from("deepfake_findings")
        .select("is_synthetic,risk_level,confidence,review_status,finding_classification")
        .eq("user_id", opts.userId)
        .or(`url.eq.${opts.imageUrl},canonical_url.eq.${opts.imageUrl}`)
        .limit(1)
        .maybeSingle(),
      opts.supabase
        .from("face_match_events")
        .select("id,matched_face_id")
        .eq("user_id", opts.userId)
        .eq("scan_hit_id", opts.scanHitId),
    ]);
    const seen = new Set((existing ?? []).map((e: { matched_face_id: string | null }) => e.matched_face_id));

    let inserted = 0;
    for (const m of accepted) {
      if (seen.has(m.faceId)) continue; // never duplicate a finding
      const pf = byFace.get(m.faceId);
      const verdict = classifyFaceLinkedFinding({
        similarity: m.similarity ?? null,
        hit: hitRow ?? null,
        deepfake: dfRow ?? null,
      });
      await opts.supabase.from("face_match_events").insert({
        user_id: opts.userId,
        collection_id: collectionId,
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
        threat_category: verdict.category,
        context_notes: verdict.reason,
        review_status: verdict.reviewStatus,
      });
      inserted += 1;
    }
    return { ok: true, matches: inserted };
  } catch (e) {
    console.warn("[face-scan] analyzeHit failed", (e as Error).message);
    return { ok: false, reason: (e as Error).message };
  }
}

export function pickScanImageUrl(hit: {
  thumbnail_url?: string | null;
  permalink?: string | null;
  canonical_url?: string | null;
  source?: string | null;
}): {
  url: string;
  type: "youtube_thumb" | "profile" | "news" | "website" | "screenshot" | "other";
} | null {
  const yt = youtubeThumbFromUrl(hit.permalink) ?? youtubeThumbFromUrl(hit.canonical_url);
  if (yt) return { url: yt, type: "youtube_thumb" };
  if (isValidImageUrl(hit.thumbnail_url)) {
    const t = (hit.source ?? "").toLowerCase().includes("news") ? "news" : "website";
    return { url: hit.thumbnail_url!, type: t };
  }
  return null;
}
