import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const SourceType = z.enum(["youtube_thumb", "profile", "news", "website", "screenshot", "other"]);

const AnalyzeInput = z.object({
  scanHitId: z.string().uuid().optional(),
  images: z.array(z.object({ url: z.string().url(), type: SourceType.default("other") })).min(1).max(10),
});

/** Server-side face scan of one or more image URLs against the user's Rekognition collection. */
export const analyzeImagesForFaces = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AnalyzeInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: col } = await supabase
      .from("rekognition_collections")
      .select("collection_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!col?.collection_id) return { ok: true, matches: [], reason: "no_collection" };

    const { fetchImageBytes, putObject, getBucket } = await import("./aws/s3.server");
    const { searchFacesByImage } = await import("./aws/rekognition.server");
    const bucket = getBucket();

    const results: Array<{
      sourceUrl: string;
      sourceType: string;
      matches: number;
      topSimilarity: number | null;
      eventIds: string[];
    }> = [];

    for (const img of data.images) {
      const bytes = await fetchImageBytes(img.url);
      if (!bytes) {
        results.push({ sourceUrl: img.url, sourceType: img.type, matches: 0, topSimilarity: null, eventIds: [] });
        continue;
      }
      const { matches, searchedFaceConfidence, searchedFaceBoundingBox } = await searchFacesByImage({
        collectionId: col.collection_id, bytes: bytes.bytes, threshold: 80, maxFaces: 5,
      });

      if (matches.length === 0) {
        results.push({ sourceUrl: img.url, sourceType: img.type, matches: 0, topSimilarity: null, eventIds: [] });
        continue;
      }

      // Persist the searched image to S3 (evidence)
      const now = new Date();
      const key = `clients/${userId}/scan-images/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}`;
      try {
        await putObject({ key, body: bytes.bytes, contentType: bytes.contentType, metadata: { source: img.url.slice(0, 512) } });
      } catch { /* keep going; S3 failure shouldn't drop matches */ }

      // Look up the protected_faces rows for the matched face_ids
      const faceIds = matches.map((m) => m.faceId);
      const { data: protectedRows } = await supabase
        .from("protected_faces")
        .select("id,face_id,asset_id,discovered_account_id,label,platform,source_url")
        .in("face_id", faceIds)
        .eq("user_id", userId);

      const byFace = new Map<string, typeof protectedRows extends null ? never : NonNullable<typeof protectedRows>[number]>();
      for (const p of protectedRows ?? []) byFace.set(p.face_id, p);

      const eventIds: string[] = [];
      for (const m of matches) {
        const pf = byFace.get(m.faceId);
        const { data: inserted } = await supabase
          .from("face_match_events")
          .insert({
            user_id: userId,
            collection_id: col.collection_id,
            matched_face_id: m.faceId,
            matched_protected_face_id: pf?.id ?? null,
            matched_asset_id: pf?.asset_id ?? null,
            similarity: m.similarity,
            face_confidence: searchedFaceConfidence ?? null,
            source_url: img.url,
            source_type: img.type,
            scan_hit_id: data.scanHitId ?? null,
            image_s3_bucket: bucket,
            image_s3_key: key,
            bounding_box: (searchedFaceBoundingBox as object) ?? null,
            review_status: "pending",
          })
          .select("id")
          .single();
        if (inserted?.id) eventIds.push(inserted.id);
      }

      results.push({
        sourceUrl: img.url,
        sourceType: img.type,
        matches: matches.length,
        topSimilarity: matches[0]?.similarity ?? null,
        eventIds,
      });
    }

    return { ok: true, matches: results };
  });

const ListInput = z.object({
  status: z.enum(["pending", "authorized", "harmless", "threat_created", "dismissed"]).optional(),
  category: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const listFaceMatches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ListInput.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let q = supabase
      .from("face_match_events")
      .select("id,similarity,face_confidence,source_url,source_type,scan_hit_id,image_s3_bucket,image_s3_key,review_status,threat_category,context_notes,created_at,matched_face_id,matched_protected_face_id,matched_asset_id,enforcement_request_id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.status) q = q.eq("review_status", data.status);
    if (data.category) q = q.eq("threat_category", data.category);
    const { data: rows, error } = await q;
    if (error) throw error;

    // Sign S3 URLs for preview
    if (rows && rows.length > 0) {
      const { getSignedGetUrl } = await import("./aws/s3.server");
      for (const r of rows) {
        if (r.image_s3_key) {
          try { (r as unknown as { signed_url: string }).signed_url = await getSignedGetUrl(r.image_s3_key, 300); }
          catch { /* ignore */ }
        }
      }
    }
    return rows ?? [];
  });

const ReviewInput = z.object({
  id: z.string().uuid(),
  decision: z.enum(["authorized", "harmless", "threat_created", "dismissed"]),
  category: z.enum(["impersonation", "fake_endorsement", "unauthorized_image", "face_misuse", "celebrity_detection"]).optional(),
  notes: z.string().min(1).max(2000),
});

export const reviewFaceMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ReviewInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: ev, error } = await supabase
      .from("face_match_events")
      .select("id,similarity,source_url,source_type,scan_hit_id,matched_asset_id")
      .eq("id", data.id).eq("user_id", userId).maybeSingle();
    if (error) throw error;
    if (!ev) throw new Error("Event not found");

    if (data.decision === "threat_created") {
      if (!data.category) throw new Error("Category is required to create a threat");
      if ((ev.similarity ?? 0) < 80) throw new Error("Similarity below 80 — cannot create threat from this match alone");
    }

    let enforcementId: string | null = null;
    if (data.decision === "threat_created") {
      const { data: er, error: erErr } = await supabase
        .from("enforcement_requests")
        .insert({
          user_id: userId,
          scan_hit_id: ev.scan_hit_id,
          platform: ev.source_type ?? "Web",
          method: `face_${data.category}`,
          target_url: ev.source_url,
          status: "Draft",
          metadata: { created_from: "face_match_review", face_match_event_id: ev.id, category: data.category },
        })
        .select("id").single();
      if (erErr || !er) throw erErr ?? new Error("Failed to create enforcement request");
      enforcementId = er.id;
    }

    const { error: upErr } = await supabase.from("face_match_events").update({
      review_status: data.decision,
      threat_category: data.decision === "threat_created" ? data.category : null,
      context_notes: data.notes,
      reviewed_at: new Date().toISOString(),
      reviewed_by: userId,
      enforcement_request_id: enforcementId,
    }).eq("id", ev.id).eq("user_id", userId);
    if (upErr) throw upErr;

    return { ok: true, enforcementRequestId: enforcementId };
  });

export const getFaceProtectionStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const day = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const week = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

    const [faces, matches24h, impersonation, fakeEndorse, evidenceCount] = await Promise.all([
      supabase.from("protected_faces").select("id", { count: "exact", head: true }).eq("user_id", userId),
      supabase.from("face_match_events").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", day),
      supabase.from("face_match_events").select("id", { count: "exact", head: true })
        .eq("user_id", userId).eq("threat_category", "impersonation").eq("review_status", "threat_created").gte("created_at", week),
      supabase.from("face_match_events").select("id", { count: "exact", head: true })
        .eq("user_id", userId).eq("threat_category", "fake_endorsement").eq("review_status", "threat_created").gte("created_at", week),
      supabase.from("evidence_vault_items").select("id", { count: "exact", head: true }).eq("user_id", userId),
    ]);

    return {
      protectedFaces: faces.count ?? 0,
      faceMatches24h: matches24h.count ?? 0,
      impersonationAlerts7d: impersonation.count ?? 0,
      fakeEndorsements7d: fakeEndorse.count ?? 0,
      evidenceItems: evidenceCount.count ?? 0,
    };
  });
