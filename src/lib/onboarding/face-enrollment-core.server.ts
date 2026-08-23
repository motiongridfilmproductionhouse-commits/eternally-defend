/**
 * Shared AWS Face Liveness + protected-face enrollment pipeline.
 *
 * This is the single enrollment implementation. Both the authenticated desktop
 * server functions and the short-lived phone hand-off server functions call
 * into it, so there is exactly one liveness/enrollment path.
 */
import { ensureCollection, collectionIdForUser } from "@/lib/aws/rekognition.server";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

export type AwsErrorInfo = { code: string; message: string; retryable: boolean };

export function classifyAwsError(e: any): AwsErrorInfo {
  const name = e?.name ?? e?.Code ?? "";
  const raw = String(e?.message ?? e);
  if (name === "AccessDeniedException" || /not authorized|AccessDenied/i.test(raw)) {
    return {
      code: "AWS_CONFIG_ERROR",
      message:
        "Face Protection is temporarily unavailable (service permissions). You can retry or complete this setup later.",
      retryable: true,
    };
  }
  if (name === "InvalidSignatureException" || /Signature|clock skew/i.test(raw)) {
    return {
      code: "AWS_CREDENTIALS_ERROR",
      message:
        "Face Protection is temporarily unavailable (credential sync). You can retry or complete this setup later.",
      retryable: true,
    };
  }
  if (/region|endpoint/i.test(raw)) {
    return {
      code: "AWS_REGION_ERROR",
      message:
        "Face Protection is temporarily unavailable (region mismatch). You can retry or complete this setup later.",
      retryable: true,
    };
  }
  if (name === "SessionNotFoundException" || /session.*(expired|not found)/i.test(raw)) {
    return {
      code: "AWS_SESSION_ERROR",
      message:
        "The face scan session expired. Please restart the scan or complete this setup later.",
      retryable: true,
    };
  }
  if (
    name === "ThrottlingException" ||
    name === "ServiceUnavailableException" ||
    /throttl|unavailable|timeout/i.test(raw)
  ) {
    return {
      code: "AWS_SERVICE_ERROR",
      message:
        "Face Protection is temporarily unavailable. You can retry or complete this setup later.",
      retryable: true,
    };
  }
  return { code: "UNKNOWN", message: raw || "Face Protection error", retryable: true };
}

// AWS Face Liveness confidence gate for enrollment. AWS guidance for
// enrollment-grade checks is 70+; 80 rejected valid users in normal lighting.
export const LIVENESS_MIN_CONFIDENCE = 70;

export function describeLivenessFailure(
  status: string | undefined,
  confidence: number,
): { code: string; message: string } {
  if (status === "FAILED") {
    return {
      code: "LIVENESS_FAILED",
      message: `Liveness check failed (confidence ${confidence.toFixed(1)}%). Please ensure you are well-lit, facing the camera, and follow the on-screen prompts.`,
    };
  }
  if (status === "EXPIRED") {
    return {
      code: "LIVENESS_EXPIRED",
      message: "The liveness session expired before completing. Please start a new scan.",
    };
  }
  if (status === "SUCCEEDED" && confidence < LIVENESS_MIN_CONFIDENCE) {
    return {
      code: "LOW_CONFIDENCE",
      message: `Liveness confidence too low (${confidence.toFixed(1)}%). Please retry in a well-lit area, without masks or heavy glasses.`,
    };
  }
  return {
    code: "LIVENESS_UNKNOWN",
    message: `Liveness result "${status ?? "UNKNOWN"}" could not be verified. Please retry the scan.`,
  };
}

export const REQUIRED_CONSENT_KEYS = ["processing", "usage", "revocable", "own_face"] as const;

export async function recordConsentFor(
  supabase: Db,
  userId: string,
  input: {
    consents: Record<string, boolean>;
    consent_version: string;
    userAgent?: string | null;
    ipAddress?: string | null;
  },
) {
  for (const k of REQUIRED_CONSENT_KEYS)
    if (!input.consents[k]) throw new Error(`Consent required: ${k}`);

  const { data: profile } = await supabase
    .from("client_profiles")
    .select("client_id")
    .eq("user_id", userId)
    .maybeSingle();
  const clientId = profile?.client_id ?? null;

  const consentPayload = {
    ...input.consents,
    client_id: clientId,
    accepted_at: new Date().toISOString(),
    status: "ACTIVE",
    consent_text_identifier: `consent_v${input.consent_version}`,
  };

  const { data: row, error } = await supabase
    .from("biometric_consents")
    .insert({
      user_id: userId,
      consent_version: input.consent_version,
      consents: consentPayload as any,
      user_agent: input.userAgent ?? null,
      ip_address: input.ipAddress ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  await supabase.from("protected_face_profiles").upsert(
    {
      user_id: userId,
      collection_id: collectionIdForUser(userId),
      status: "CAMERA_PERMISSION_REQUIRED",
    },
    { onConflict: "user_id" },
  );

  return row;
}

export async function hasActiveConsent(supabase: Db, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("biometric_consents")
    .select("id")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .order("signed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return !!data;
}

export async function createLivenessSessionFor(supabase: Db, userId: string) {
  try {
    const consentOk = await hasActiveConsent(supabase, userId);
    if (!consentOk) {
      await supabase.from("protected_face_profiles").upsert(
        {
          user_id: userId,
          collection_id: collectionIdForUser(userId),
          status: "CONSENT_REQUIRED",
        } as any,
        { onConflict: "user_id" },
      );
      throw new Error("CONSENT_REQUIRED: Please accept the biometric consent before scanning.");
    }

    const { CreateFaceLivenessSessionCommand } = await import("@aws-sdk/client-rekognition");
    const { getRekognition, getBucket } = await import("@/lib/aws/clients.server");
    const { STSClient, GetSessionTokenCommand } = await import("@aws-sdk/client-sts");

    const collectionId = await ensureCollection(userId);
    const out = await getRekognition().send(
      new CreateFaceLivenessSessionCommand({
        Settings: {
          OutputConfig: { S3Bucket: getBucket(), S3KeyPrefix: `clients/${userId}/liveness/` },
          AuditImagesLimit: 4,
        },
      }),
    );
    const sid = out.SessionId!;
    await supabase.from("protected_face_profiles").upsert(
      {
        user_id: userId,
        collection_id: collectionId,
        liveness_session_id: sid,
        status: "CAPTURE_IN_PROGRESS",
        failure_code: null,
        failure_reason: null,
        failure_at: null,
      } as any,
      { onConflict: "user_id" },
    );

    const region = process.env.AWS_REGION || "us-east-1";
    const sts = new STSClient({
      region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
    const stsCreds = await sts.send(new GetSessionTokenCommand({ DurationSeconds: 900 }));

    return {
      sessionId: sid,
      region,
      credentials: {
        accessKeyId: stsCreds.Credentials!.AccessKeyId!,
        secretAccessKey: stsCreds.Credentials!.SecretAccessKey!,
        sessionToken: stsCreds.Credentials!.SessionToken!,
        expiration: stsCreds.Credentials!.Expiration!.toISOString(),
      },
    };
  } catch (e: any) {
    if (/Biometric consent|CONSENT_REQUIRED/i.test(String(e?.message))) throw e;
    const info = classifyAwsError(e);
    // Diagnostics only — no secret values. Production (custom domain) runs on a
    // separate host with its own env, so a stale/whitespace-padded AWS key there
    // signs requests that AWS rejects while the same code works elsewhere.
    console.error(
      "[face-enrollment] AWS failure",
      JSON.stringify({
        code: info.code,
        awsName: e?.name ?? null,
        awsMessage: String(e?.message ?? e).slice(0, 300),
        env: awsEnvFingerprint(),
      }),
    );
    await supabase.from("protected_face_profiles").upsert(
      {
        user_id: userId,
        collection_id: collectionIdForUser(userId),
        status: "CONSENT_REQUIRED",
        failure_code: info.code,
        failure_reason: info.message,
        failure_at: new Date().toISOString(),
      } as any,
      { onConflict: "user_id" },
    );
    const err: any = new Error(info.message);
    err.code = info.code;
    err.retryable = info.retryable;
    throw err;
  }
}

export type FinalizeResult =
  | {
      ok: true;
      status: "FACE_VERIFIED";
      confidence: number;
      faceIds: string[];
      landmarks: { type: string; x: number; y: number }[];
      boundingBox: { Width?: number; Height?: number; Left?: number; Top?: number } | null;
      quality: { sharpness?: number; brightness?: number } | null;
      referenceImage: string | null;
    }
  | {
      ok: false;
      status: "LIVENESS_FAILED" | "QUALITY_FAILED";
      code: string;
      reason: string;
      confidence: number;
      technical: boolean;
    };

export async function finalizeLivenessFor(
  supabase: Db,
  userId: string,
  sessionId: string,
): Promise<FinalizeResult> {
  const { data: prof, error: profErr } = await supabase
    .from("protected_face_profiles")
    .select("id, liveness_session_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (profErr || !prof || prof.liveness_session_id !== sessionId) {
    throw new Error("Unauthorized: Liveness session does not match authenticated user.");
  }

  let res: any;
  try {
    const { GetFaceLivenessSessionResultsCommand } = await import("@aws-sdk/client-rekognition");
    const { getRekognition } = await import("@/lib/aws/clients.server");
    res = await getRekognition().send(
      new GetFaceLivenessSessionResultsCommand({ SessionId: sessionId }),
    );
  } catch (e: any) {
    const info = classifyAwsError(e);
    await supabase
      .from("protected_face_profiles")
      .update({
        status: "LIVENESS_FAILED",
        failure_code: info.code,
        failure_reason: info.message,
        failure_at: new Date().toISOString(),
      } as any)
      .eq("user_id", userId);
    return {
      ok: false,
      status: "LIVENESS_FAILED",
      code: info.code,
      reason: info.message,
      confidence: 0,
      technical: true,
    };
  }

  const conf = Number(res.Confidence ?? 0);
  const awsStatus = String(res.Status ?? "UNKNOWN");
  const pass = awsStatus === "SUCCEEDED" && conf >= LIVENESS_MIN_CONFIDENCE;

  if (!pass) {
    const detail = describeLivenessFailure(awsStatus, conf);
    await supabase
      .from("protected_face_profiles")
      .update({
        status: "LIVENESS_FAILED",
        liveness_score: conf,
        failure_code: detail.code,
        failure_reason: detail.message,
        failure_at: new Date().toISOString(),
      } as any)
      .eq("user_id", userId);
    return {
      ok: false,
      status: "LIVENESS_FAILED",
      code: detail.code,
      reason: detail.message,
      confidence: conf,
      technical: false,
    };
  }

  const collectionId = await ensureCollection(userId);
  // With OutputConfig set, AWS returns the reference/audit images as S3 objects
  // instead of inline bytes, so resolve either shape.
  const { getObjectBytes } = await import("@/lib/aws/s3.server");
  const candidates = [res.ReferenceImage, ...(res.AuditImages ?? [])].filter(Boolean) as Array<{
    Bytes?: Uint8Array;
    S3Object?: { Bucket?: string; Name?: string };
  }>;
  let ref: Uint8Array | undefined;
  for (const c of candidates) {
    if (c.Bytes && c.Bytes.length > 0) {
      ref = c.Bytes;
      break;
    }
    if (c.S3Object?.Name) {
      const bytes = await getObjectBytes(c.S3Object.Name, c.S3Object.Bucket);
      if (bytes && bytes.length > 0) {
        ref = bytes;
        break;
      }
    }
  }
  const savedFaceIds: string[] = [];
  let landmarks: { type: string; x: number; y: number }[] = [];
  let boundingBox: { Width?: number; Height?: number; Left?: number; Top?: number } | null = null;
  let quality: { sharpness?: number; brightness?: number } | null = null;
  let referenceImage: string | null = null;
  try {
    if (!ref) {
      throw new Error("AWS returned no reference image. Please repeat the face scan.");
    }

    const { indexFace } = await import("@/lib/aws/rekognition.server");
    const { putObject } = await import("@/lib/aws/s3.server");
    const bytes = ref as Uint8Array;
    const key = `clients/${userId}/reference/liveness/${sessionId}.jpg`;
    const stored = await putObject({ key, body: Buffer.from(bytes), contentType: "image/jpeg" });
    const faces = await indexFace({
      collectionId,
      bytes,
      externalImageId: `user_${userId.replace(/-/g, "")}`,
    });

    if (faces.length === 0) {
      throw new Error("AWS did not index a valid face. Please repeat the face scan.");
    }

    // Real AWS-provided signals used by the enrollment visualization.
    landmarks = faces[0].landmarks ?? [];
    boundingBox = (faces[0].boundingBox ?? null) as typeof boundingBox;
    quality = faces[0].quality ?? null;
    referenceImage = `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`;

    // Reusable protected reference: registering the collection is what makes
    // the enrolled face available to automatic monitoring and manual scans.
    const { error: collectionError } = await supabase
      .from("rekognition_collections")
      .upsert(
        { user_id: userId, collection_id: collectionId, status: "active" },
        { onConflict: "user_id" },
      );
    if (collectionError) throw collectionError;

    const { data: clientProfile } = await supabase
      .from("client_profiles")
      .select("display_name,full_name")
      .eq("user_id", userId)
      .maybeSingle();
    const referenceLabel =
      clientProfile?.display_name?.trim() ||
      clientProfile?.full_name?.trim() ||
      "Verified liveness reference";
    const verifiedAt = new Date().toISOString();

    const { buildEnrollmentFaceRow } = await import(
      "@/lib/face-protection/protected-face-registry"
    );

    for (const f of faces) {
      const { data: existing, error: lookupError } = await supabase
        .from("protected_faces")
        .select("id")
        .eq("user_id", userId)
        .eq("face_id", f.faceId)
        .maybeSingle();
      if (lookupError) throw lookupError;

      const row = buildEnrollmentFaceRow({
        userId,
        collectionId,
        faceId: f.faceId,
        imageId: f.imageId ?? null,
        externalImageId: f.externalImageId ?? null,
        confidence: f.confidence ?? null,
        boundingBox: f.boundingBox ?? null,
        s3Bucket: stored.bucket,
        s3Key: stored.key,
        label: referenceLabel,
        verifiedAt,
      });

      if (existing) {
        // Re-enrollment refreshes the same reference instead of duplicating it.
        const { error: updateError } = await supabase
          .from("protected_faces")
          .update({
            status: row.status,
            last_verified_at: row.last_verified_at,
            s3_bucket: row.s3_bucket,
            s3_key: row.s3_key,
            confidence: row.confidence,
            bounding_box: row.bounding_box as never,
            label: row.label,
            source: row.source,
          })
          .eq("id", existing.id)
          .eq("user_id", userId);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from("protected_faces")
          .insert(row as never);
        if (insertError) throw insertError;
      }

      savedFaceIds.push(f.faceId);
    }

    if (savedFaceIds.length === 0) {
      throw new Error("Face indexing did not create a protected face.");
    }
  } catch (e: any) {
    const info = classifyAwsError(e);
    await supabase
      .from("protected_face_profiles")
      .update({
        status: "QUALITY_FAILED",
        liveness_score: conf,
        failure_code: info.code,
        failure_reason: `Face indexing failed: ${info.message}`,
        failure_at: new Date().toISOString(),
      } as any)
      .eq("user_id", userId);
    return {
      ok: false,
      status: "QUALITY_FAILED",
      code: info.code,
      reason: info.message,
      confidence: conf,
      technical: true,
    };
  }

  await supabase
    .from("protected_face_profiles")
    .update({
      status: "FACE_VERIFIED",
      liveness_score: conf,
      enrollment_date: new Date().toISOString(),
      failure_code: null,
      failure_reason: null,
      failure_at: null,
    } as any)
    .eq("user_id", userId);

  const { upsertProgressPreservingVersion, normalizeOnboardingVersion } = await import(
    "./version.server"
  );
  const { data: progress } = await supabase
    .from("onboarding_progress")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  const version = normalizeOnboardingVersion(progress?.onboarding_version);
  if (version === "v1") {
    const states = {
      ...((progress?.step_states as Record<string, string>) ?? {}),
      "2": "COMPLETED",
    };
    await upsertProgressPreservingVersion(supabase, userId, {
      current_step: Math.max(progress?.current_step ?? 1, 3),
      step_states: states,
      overall_status: "IN_PROGRESS",
    });
  } else {
    await upsertProgressPreservingVersion(supabase, userId, {
      overall_status: "IN_PROGRESS",
    });
  }

  return {
    ok: true,
    status: "FACE_VERIFIED",
    confidence: conf,
    faceIds: savedFaceIds,
    landmarks,
    boundingBox,
    quality,
    referenceImage,
  };
}
