import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { ensureCollection, collectionIdForUser } from "@/lib/aws/rekognition.server";

function classifyAwsError(e: any): { code: string; message: string; retryable: boolean } {
  const name = e?.name ?? e?.Code ?? "";
  const raw = String(e?.message ?? e);
  if (name === "AccessDeniedException" || /not authorized|AccessDenied/i.test(raw)) {
    return { code: "AWS_CONFIG_ERROR", message: "Face Protection is temporarily unavailable (service permissions). You can retry or complete this setup later.", retryable: true };
  }
  if (name === "InvalidSignatureException" || /Signature|clock skew/i.test(raw)) {
    return { code: "AWS_CREDENTIALS_ERROR", message: "Face Protection is temporarily unavailable (credential sync). You can retry or complete this setup later.", retryable: true };
  }
  if (/region|endpoint/i.test(raw)) {
    return { code: "AWS_REGION_ERROR", message: "Face Protection is temporarily unavailable (region mismatch). You can retry or complete this setup later.", retryable: true };
  }
  if (name === "SessionNotFoundException" || /session.*(expired|not found)/i.test(raw)) {
    return { code: "AWS_SESSION_ERROR", message: "The face scan session expired. Please restart the scan or complete this setup later.", retryable: true };
  }
  if (name === "ThrottlingException" || name === "ServiceUnavailableException" || /throttl|unavailable|timeout/i.test(raw)) {
    return { code: "AWS_SERVICE_ERROR", message: "Face Protection is temporarily unavailable. You can retry or complete this setup later.", retryable: true };
  }
  return { code: "UNKNOWN", message: raw || "Face Protection error", retryable: true };
}


export const recordBiometricConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { consents: Record<string, boolean>; consent_version: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const required = ["processing", "usage", "revocable", "own_face"];
    for (const k of required) if (!data.consents[k]) throw new Error(`Consent required: ${k}`);

    const { data: profile } = await supabase
      .from("client_profiles")
      .select("client_id")
      .eq("user_id", userId)
      .maybeSingle();
    const clientId = profile?.client_id ?? null;

    const request = getRequest();
    const userAgent = request?.headers?.get("user-agent") || null;
    const ipAddress = request?.headers?.get("x-forwarded-for") || null;

    const consentPayload = {
      ...data.consents,
      client_id: clientId,
      accepted_at: new Date().toISOString(),
      status: "ACTIVE",
      consent_text_identifier: `consent_v${data.consent_version}`,
    };

    const { data: row, error } = await supabase.from("biometric_consents").insert({
      user_id: userId,
      consent_version: data.consent_version,
      consents: consentPayload as any,
      user_agent: userAgent,
      ip_address: ipAddress,
    }).select().single();
    if (error) throw new Error(error.message);

    await supabase.from("protected_face_profiles").upsert({
      user_id: userId,
      collection_id: collectionIdForUser(userId),
      status: "CAMERA_PERMISSION_REQUIRED",
    }, { onConflict: "user_id" });

    return row;
  });

export const createLivenessSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    try {
      // Verify consent exists
      const { data: consent } = await supabase.from("biometric_consents").select("id").eq("user_id", userId).is("revoked_at", null).order("signed_at", { ascending: false }).limit(1).maybeSingle();
      if (!consent) throw new Error("Biometric consent required");
      const { CreateFaceLivenessSessionCommand } = await import("@aws-sdk/client-rekognition");
      const { getRekognition, getBucket } = await import("@/lib/aws/clients.server");
      const { STSClient, GetSessionTokenCommand } = await import("@aws-sdk/client-sts");

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

      const region = process.env.AWS_REGION || "us-east-1";
      const sts = new STSClient({
        region,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
        }
      });

      const stsCreds = await sts.send(new GetSessionTokenCommand({ DurationSeconds: 900 }));

      return {
        sessionId: sid,
        region,
        credentials: {
          accessKeyId: stsCreds.Credentials!.AccessKeyId!,
          secretAccessKey: stsCreds.Credentials!.SecretAccessKey!,
          sessionToken: stsCreds.Credentials!.SessionToken!,
          expiration: stsCreds.Credentials!.Expiration!.toISOString()
        }
      };
    } catch (e: any) {
      if (/Biometric consent/i.test(String(e?.message))) throw e;
      const info = classifyAwsError(e);
      const err: any = new Error(info.message);
      err.code = info.code;
      err.retryable = info.retryable;
      throw err;
    }
  });

export const finalizeLiveness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { sessionId: string }) => z.object({ sessionId: z.string().min(8) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: prof, error: profErr } = await supabase
      .from("protected_face_profiles")
      .select("id, liveness_session_id")
      .eq("user_id", userId)
      .maybeSingle();
      
    if (profErr || !prof || prof.liveness_session_id !== data.sessionId) {
      throw new Error("Unauthorized: Liveness session does not match authenticated user.");
    }

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
    if (ref) {
      const bytes = ref as Uint8Array;
      const key = `clients/${userId}/reference/liveness/${data.sessionId}.jpg`;
      await putObject({ key, body: Buffer.from(bytes), contentType: "image/jpeg" });
      const faces = await indexFace({ collectionId, bytes, externalImageId: `user_${userId.replace(/-/g, "")}` });
      const profileId = prof.id;
      if (profileId) {
        for (const f of faces) {
          await supabase.from("protected_face_references").insert({
            profile_id: profileId, user_id: userId, s3_key: key, face_id: f.faceId, quality_scores: { confidence: f.confidence } as never,
          });
          if (f.faceId) savedFaceIds.push(f.faceId);
        }
      }
    }

    await supabase.from("protected_face_profiles").update({
      status: "FACE_VERIFIED",
      liveness_score: conf,
      enrollment_date: new Date().toISOString(),
    }).eq("user_id", userId);

    const { data: progress } = await supabase.from("onboarding_progress").select("*").eq("user_id", userId).maybeSingle();
    const states = {
      ...(progress?.step_states as Record<string, string> ?? {}),
      "3": "COMPLETED"
    };
    await supabase.from("onboarding_progress").upsert({
      user_id: userId,
      current_step: Math.max(progress?.current_step ?? 1, 4),
      step_states: states,
      overall_status: "IN_PROGRESS"
    }, { onConflict: "user_id" });

    return { ok: true, status: "FACE_VERIFIED", confidence: conf, faceIds: savedFaceIds };
  });

export const getFaceEnrollment = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase.from("protected_face_profiles").select("*").eq("user_id", userId).maybeSingle();
    const { data: consent } = await supabase.from("biometric_consents").select("id").eq("user_id", userId).is("revoked_at", null).order("signed_at", { ascending: false }).limit(1).maybeSingle();
    
    const dbStatus = profile?.status ?? "NOT_STARTED";
    const status = (dbStatus === "NOT_STARTED" || dbStatus === "CONSENT_REQUIRED") && consent 
      ? "CAMERA_PERMISSION_REQUIRED" 
      : dbStatus;
    
    return profile ? { ...profile, status } : { status };
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

