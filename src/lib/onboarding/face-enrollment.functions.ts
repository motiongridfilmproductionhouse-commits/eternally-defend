import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { ensureCollection, collectionIdForUser } from "@/lib/aws/rekognition.server";

export const recordBiometricConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { consents: Record<string, boolean>; consent_version: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const required = ["processing", "usage", "revocable", "own_face"];
    for (const k of required) if (!data.consents[k]) throw new Error(`Consent required: ${k}`);
    const { data: row, error } = await supabase.from("biometric_consents").insert({
      user_id: userId, consent_version: data.consent_version, consents: data.consents,
    }).select().single();
    if (error) throw new Error(error.message);
    await supabase.from("protected_face_profiles").upsert({
      user_id: userId, collection_id: collectionIdForUser(userId), status: "CONSENT_REQUIRED",
    }, { onConflict: "user_id" });
    return row;
  });

export const createLivenessSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    // Verify consent exists
    const { data: consent } = await supabase.from("biometric_consents").select("id").eq("user_id", userId).is("revoked_at", null).order("signed_at", { ascending: false }).limit(1).maybeSingle();
    if (!consent) throw new Error("Biometric consent required");
    const { CreateFaceLivenessSessionCommand } = await import("@aws-sdk/client-rekognition");
    const { getRekognition, getBucket } = await import("@/lib/aws/clients.server");
    const collectionId = await ensureCollection(userId);
    const out = await getRekognition().send(new CreateFaceLivenessSessionCommand({
      Settings: {
        OutputConfig: { S3Bucket: getBucket(), S3KeyPrefix: `clients/${userId}/liveness/` },
        AuditImagesLimit: 4,
      },
    }));
    const sid = out.SessionId!;
    await supabase.from("protected_face_profiles").upsert({
      user_id: userId, collection_id: collectionId, liveness_session_id: sid, status: "CAPTURE_IN_PROGRESS",
    }, { onConflict: "user_id" });
    return { sessionId: sid, region: process.env.AWS_REGION };
  });

export const finalizeLiveness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { sessionId: string }) => z.object({ sessionId: z.string().min(8) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { GetFaceLivenessSessionResultsCommand } = await import("@aws-sdk/client-rekognition");
    const { getRekognition } = await import("@/lib/aws/clients.server");
    const { indexFace } = await import("@/lib/aws/rekognition.server");
    const { putObject } = await import("@/lib/aws/s3.server");

    const res = await getRekognition().send(new GetFaceLivenessSessionResultsCommand({ SessionId: data.sessionId }));
    const conf = res.Confidence ?? 0;
    const pass = res.Status === "SUCCEEDED" && conf >= 80;
    if (!pass) {
      await supabase.from("protected_face_profiles").update({ status: "LIVENESS_FAILED", liveness_score: conf }).eq("user_id", userId);
      return { ok: false, status: "LIVENESS_FAILED", confidence: conf };
    }

    const collectionId = collectionIdForUser(userId);
    const ref = res.ReferenceImage?.Bytes;
    const savedFaceIds: string[] = [];
    const savedKeys: string[] = [];
    if (ref) {
      const bytes = ref as Uint8Array;
      const key = `clients/${userId}/reference/liveness/${data.sessionId}.jpg`;
      await putObject({ key, body: Buffer.from(bytes), contentType: "image/jpeg" });
      const faces = await indexFace({ collectionId, bytes, externalImageId: `user_${userId.replace(/-/g, "")}` });
      for (const f of faces) {
        await supabase.from("protected_face_references").insert({
          profile_id: (await supabase.from("protected_face_profiles").select("id").eq("user_id", userId).maybeSingle()).data?.id,
          user_id: userId, s3_key: key, face_id: f.faceId, quality_scores: { confidence: f.confidence },
        });
        if (f.faceId) savedFaceIds.push(f.faceId);
        savedKeys.push(key);
      }
    }
    void savedKeys;

    await supabase.from("protected_face_profiles").update({
      status: "FACE_VERIFIED",
      liveness_score: conf,
      enrollment_date: new Date().toISOString(),
    }).eq("user_id", userId);

    return { ok: true, status: "FACE_VERIFIED", confidence: conf, faceIds: savedFaceIds };
  });

export const getFaceEnrollment = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase.from("protected_face_profiles").select("*").eq("user_id", userId).maybeSingle();
    return data;
  });

export const revokeBiometrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: refs } = await supabase.from("protected_face_references").select("*").eq("user_id", userId);
    if (refs && refs.length) {
      const { deleteFace } = await import("@/lib/aws/rekognition.server");
      for (const r of refs) if (r.face_id) await deleteFace(collectionIdForUser(userId), r.face_id).catch(() => {});
    }
    await supabase.from("protected_face_references").delete().eq("user_id", userId);
    await supabase.from("protected_face_profiles").update({ status: "DELETED" }).eq("user_id", userId);
    await supabase.from("biometric_consents").update({ revoked_at: new Date().toISOString() }).eq("user_id", userId).is("revoked_at", null);
    return { ok: true };
  });
