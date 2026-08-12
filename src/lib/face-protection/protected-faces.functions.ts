import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  FACE_MATCH_SIMILARITY_THRESHOLD,
  FACE_REVIEW_SIMILARITY_FLOOR,
  PROTECTED_FACE_ACTIVE,
  PROTECTED_FACE_INACTIVE,
  classifyManualMatch,
  reviewStatusForVerdict,
} from "./protected-face-registry";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * Protected faces for the authenticated user, with a short-lived signed URL for
 * the private reference thumbnail. AWS FaceId/CollectionId are never returned.
 */
export const listProtectedFaceReferences = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: faces, error } = await supabase
      .from("protected_faces")
      .select(
        "id,label,platform,source,status,confidence,created_at,last_verified_at,s3_key,face_id",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;

    const [{ data: profile }, { data: clientProfile }, { data: activity }] = await Promise.all([
      supabase
        .from("protected_face_profiles")
        .select("status,enrollment_date,liveness_score")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("client_profiles")
        .select("display_name,full_name")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("face_match_events")
        .select("matched_protected_face_id,created_at,similarity,review_status")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);

    const lastActivity = new Map<
      string,
      { at: string; similarity: number | null; review_status: string }
    >();
    for (const ev of activity ?? []) {
      const key = ev.matched_protected_face_id;
      if (!key || lastActivity.has(key)) continue;
      lastActivity.set(key, {
        at: ev.created_at,
        similarity: ev.similarity ?? null,
        review_status: ev.review_status,
      });
    }

    const { getSignedGetUrl } = await import("@/lib/aws/s3.server");

    const rows = await Promise.all(
      (faces ?? []).map(async (f) => {
        let thumbnailUrl: string | null = null;
        try {
          thumbnailUrl = f.s3_key ? await getSignedGetUrl(f.s3_key, 900) : null;
        } catch {
          thumbnailUrl = null;
        }
        return {
          id: f.id,
          label: f.label,
          source: f.source ?? f.platform ?? "unknown",
          status: (f.status ?? PROTECTED_FACE_ACTIVE) as string,
          confidence: f.confidence,
          created_at: f.created_at,
          last_verified_at: f.last_verified_at ?? null,
          thumbnailUrl,
          lastActivity: lastActivity.get(f.id) ?? null,
        };
      }),
    );

    const displayName =
      clientProfile?.display_name?.trim() || clientProfile?.full_name?.trim() || null;

    return {
      displayName,
      profileStatus: profile?.status ?? "NOT_STARTED",
      enrollmentDate: profile?.enrollment_date ?? null,
      faces: rows,
    };
  });

const ManualScanInput = z.object({
  protectedFaceId: z.string().uuid(),
  imageBase64: z.string().min(64),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]).default("image/jpeg"),
  sourceUrl: z.string().url().optional(),
});

/**
 * Manual image scan against ONE enrolled protected face. Similarity values come
 * straight from Rekognition; no value is synthesized.
 */
export const manualFaceScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ManualScanInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: face, error } = await supabase
      .from("protected_faces")
      .select("id,user_id,face_id,collection_id,status,label")
      .eq("id", data.protectedFaceId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!face) throw new Error("Protected face not found");
    if ((face.status ?? PROTECTED_FACE_ACTIVE) !== PROTECTED_FACE_ACTIVE) {
      throw new Error("This protected face is inactive. Re-enroll to scan with it.");
    }

    const base64 = data.imageBase64.replace(/^data:[^;]+;base64,/, "");
    const bytes = Buffer.from(base64, "base64");
    if (bytes.length === 0) throw new Error("Uploaded image is empty.");
    if (bytes.length > MAX_UPLOAD_BYTES) throw new Error("Image exceeds the 8 MB limit.");

    const { searchFacesByImage } = await import("@/lib/aws/rekognition.server");
    const search = await searchFacesByImage({
      collectionId: face.collection_id,
      bytes: new Uint8Array(bytes),
      // Search below the match gate so borderline results can be flagged for
      // review instead of silently dropped.
      threshold: FACE_REVIEW_SIMILARITY_FLOOR,
      maxFaces: 10,
    });

    const own = search.matches.filter((m) => m.faceId === face.face_id);
    const similarity = own.length > 0 ? Math.max(...own.map((m) => m.similarity)) : null;
    const faceConfidence = search.searchedFaceConfidence ?? null;
    const faceDetected = faceConfidence !== null || search.matches.length > 0;

    const verdict = classifyManualMatch({ faceDetected, faceConfidence, similarity });

    let eventId: string | null = null;
    const reviewStatus = reviewStatusForVerdict(verdict.verdict);

    if (reviewStatus) {
      const { putObject, getBucket } = await import("@/lib/aws/s3.server");
      const key = `clients/${userId}/manual-scans/${crypto.randomUUID()}`;
      let bucket: string | null = null;
      try {
        const stored = await putObject({
          key,
          body: bytes,
          contentType: data.contentType,
          metadata: data.sourceUrl ? { source: data.sourceUrl.slice(0, 512) } : undefined,
        });
        bucket = stored.bucket ?? getBucket();
      } catch {
        bucket = null;
      }

      const { data: inserted } = await supabase
        .from("face_match_events")
        .insert({
          user_id: userId,
          collection_id: face.collection_id,
          matched_face_id: face.face_id,
          matched_protected_face_id: face.id,
          similarity: verdict.similarity,
          face_confidence: faceConfidence,
          source_url: data.sourceUrl ?? null,
          source_type: "screenshot",
          image_s3_bucket: bucket,
          image_s3_key: bucket ? key : null,
          review_status: reviewStatus,
          context_notes: `Manual scan (${verdict.reason})`,
          bounding_box: (search.searchedFaceBoundingBox ?? null) as never,
        })
        .select("id")
        .maybeSingle();
      eventId = inserted?.id ?? null;
    }

    return {
      ok: true,
      verdict: verdict.verdict,
      similarity: verdict.similarity,
      faceConfidence,
      faceDetected,
      reason: verdict.reason,
      threshold: FACE_MATCH_SIMILARITY_THRESHOLD,
      matchEventId: eventId,
    };
  });

/** Deactivate a protected face so monitoring stops using it (AWS face removed). */
export const deactivateProtectedFace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("protected_faces")
      .select("id,user_id,collection_id,face_id")
      .eq("id", data.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!row) throw new Error("Protected face not found");

    // Flip status first: even if the AWS delete fails, monitoring stops using it.
    await supabase
      .from("protected_faces")
      .update({ status: PROTECTED_FACE_INACTIVE })
      .eq("id", row.id)
      .eq("user_id", userId);

    try {
      const { deleteFace } = await import("@/lib/aws/rekognition.server");
      await deleteFace(row.collection_id, row.face_id);
    } catch {
      /* AWS reference may already be gone; app record is deactivated. */
    }

    return { ok: true };
  });
