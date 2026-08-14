import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { collectionIdForUser } from "@/lib/aws/rekognition.server";

export const recordBiometricConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { consents: Record<string, boolean>; consent_version: string }) => d)
  .handler(async ({ data, context }) => {
    const { recordConsentFor } = await import("./face-enrollment-core.server");
    const request = getRequest();
    return recordConsentFor(context.supabase, context.userId, {
      consents: data.consents,
      consent_version: data.consent_version,
      userAgent: request?.headers?.get("user-agent") || null,
      ipAddress: request?.headers?.get("x-forwarded-for") || null,
    });
  });

export const createLivenessSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { createLivenessSessionFor } = await import("./face-enrollment-core.server");
    return createLivenessSessionFor(context.supabase, context.userId);
  });

export const finalizeLiveness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { sessionId: string }) => z.object({ sessionId: z.string().min(8) }).parse(d))
  .handler(async ({ data, context }) => {
    const { finalizeLivenessFor } = await import("./face-enrollment-core.server");
    return finalizeLivenessFor(context.supabase, context.userId, data.sessionId);
  });

export const getFaceEnrollment = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("protected_face_profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    const { data: consent } = await supabase
      .from("biometric_consents")
      .select("id")
      .eq("user_id", userId)
      .is("revoked_at", null)
      .order("signed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const dbStatus = profile?.status ?? "NOT_STARTED";
    // Consent presence is authoritative: without an active consent the user must
    // never land on the scan screen (the liveness session would hard-fail).
    const status = consent
      ? dbStatus === "NOT_STARTED" || dbStatus === "CONSENT_REQUIRED"
        ? "CAMERA_PERMISSION_REQUIRED"
        : dbStatus
      : dbStatus === "FACE_VERIFIED" || dbStatus === "DEFERRED" || dbStatus === "DELETED"
        ? dbStatus
        : "CONSENT_REQUIRED";

    return profile ? { ...profile, status } : { status };
  });

export const revokeBiometrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: refs } = await supabase
      .from("protected_face_references")
      .select("*")
      .eq("user_id", userId);
    if (refs && refs.length) {
      const { deleteFace } = await import("@/lib/aws/rekognition.server");
      for (const r of refs)
        if (r.face_id) await deleteFace(collectionIdForUser(userId), r.face_id).catch(() => {});
    }
    await supabase.from("protected_face_references").delete().eq("user_id", userId);
    await supabase
      .from("protected_face_profiles")
      .update({ status: "DELETED" })
      .eq("user_id", userId);
    await supabase
      .from("biometric_consents")
      .update({ revoked_at: new Date().toISOString() })
      .eq("user_id", userId)
      .is("revoked_at", null);
    return { ok: true };
  });

/**
 * Defer face enrollment. Veriff is not part of signup onboarding, so no KYC
 * gate applies here. Marks the face profile DEFERRED.
 */
export const deferFaceEnrollment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { upsertProgressPreservingVersion, normalizeOnboardingVersion } =
      await import("./version.server");
    const { isV2AccountType } = await import("./v2-config");

    const { data: progress } = await supabase
      .from("onboarding_progress")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    const version = normalizeOnboardingVersion(progress?.onboarding_version);

    const { data: profile } = await supabase
      .from("client_profiles")
      .select("onboarding_account_type")
      .eq("user_id", userId)
      .maybeSingle();
    const accountType = isV2AccountType(profile?.onboarding_account_type)
      ? profile.onboarding_account_type
      : null;
    // Veriff is no longer collected during onboarding, so deferring face
    // protection is not gated on KYC. Identity verification is still enforced
    // later for sensitive actions (DMCA authorization, enforcement eligibility).

    await supabase.from("protected_face_profiles").upsert(
      {
        user_id: userId,
        collection_id: collectionIdForUser(userId),
        status: "DEFERRED",
      },
      { onConflict: "user_id" },
    );

    if (version === "v1") {
      const states = {
        ...((progress?.step_states as Record<string, string>) ?? {}),
        "3": "DEFERRED",
      };
      await upsertProgressPreservingVersion(supabase, userId, {
        current_step: Math.max(progress?.current_step ?? 1, 4),
        step_states: states,
        overall_status: "IN_PROGRESS",
      });
    } else {
      await upsertProgressPreservingVersion(supabase, userId, {
        overall_status: "IN_PROGRESS",
      });
    }

    return { ok: true, status: "DEFERRED" as const };
  });

/**
 * Resume face enrollment for a user whose profile is DEFERRED, LIVENESS_FAILED,
 * QUALITY_FAILED, or otherwise stuck. Resets the profile to a scan-ready state
 * without deleting existing biometric consent. Onboarding progress step 3 is
 * moved back to IN_PROGRESS so the user must actually pass before advancing.
 */
export const resumeFaceEnrollment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: consent } = await supabase
      .from("biometric_consents")
      .select("id")
      .eq("user_id", userId)
      .is("revoked_at", null)
      .order("signed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextStatus = consent ? "CAMERA_PERMISSION_REQUIRED" : "CONSENT_REQUIRED";

    await supabase.from("protected_face_profiles").upsert(
      {
        user_id: userId,
        collection_id: collectionIdForUser(userId),
        status: nextStatus,
        liveness_session_id: null,
        failure_code: null,
        failure_reason: null,
        failure_at: null,
      } as any,
      { onConflict: "user_id" },
    );

    const { upsertProgressPreservingVersion, normalizeOnboardingVersion } =
      await import("./version.server");
    const { data: progress } = await supabase
      .from("onboarding_progress")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    const version = normalizeOnboardingVersion(progress?.onboarding_version);
    if (version === "v1") {
      const states = {
        ...((progress?.step_states as Record<string, string>) ?? {}),
        "3": "IN_PROGRESS",
      };
      await upsertProgressPreservingVersion(supabase, userId, {
        current_step: 3,
        step_states: states,
        overall_status: "IN_PROGRESS",
      });
    } else {
      await upsertProgressPreservingVersion(supabase, userId, {
        overall_status: "IN_PROGRESS",
      });
    }

    return { ok: true, status: nextStatus };
  });
