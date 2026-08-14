import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ACCOUNT_TYPE_ONBOARDING_VERSION,
  getOrAssignOnboardingVersion,
  normalizeOnboardingVersion,
} from "./version.server";
import {
  ONBOARDING_V2,
  V2_BADGES,
  V2_VERIFICATION_METHODS,
  isV2AccountType,
  primaryEvidenceTypeForAccount,
  requiresFaceProtection,
  requiresRepresentative,
  requiresVeriff,
  v2FlowForAccount,
  type V2AccountType,
} from "./v2-config";

export type StepStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "ACTION_REQUIRED"
  | "UNDER_REVIEW"
  | "VERIFIED"
  | "REJECTED"
  | "COMPLETED"
  | "DEFERRED";

async function loadV2AccountType(
  supabase: Parameters<typeof getOrAssignOnboardingVersion>[0],
  userId: string,
): Promise<V2AccountType | null> {
  const { data: profile } = await supabase
    .from("client_profiles")
    .select("onboarding_account_type")
    .eq("user_id", userId)
    .maybeSingle();
  return isV2AccountType(profile?.onboarding_account_type) ? profile.onboarding_account_type : null;
}

export const getProgress = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const onboardingVersion = await getOrAssignOnboardingVersion(supabase, userId);

    const { data, error } = await supabase
      .from("onboarding_progress")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throw new Error(`Unable to load onboarding progress: ${error.message}`);
    }

    if (!data) {
      const seed = {
        user_id: userId,
        current_step: 1,
        overall_status: "IN_PROGRESS" as const,
        step_states: {},
        onboarding_version: onboardingVersion,
      };

      const { data: created, error: createError } = await supabase
        .from("onboarding_progress")
        .insert(seed)
        .select()
        .single();

      if (createError) {
        throw new Error(`Unable to create onboarding progress: ${createError.message}`);
      }

      return {
        ...created,
        onboarding_version: normalizeOnboardingVersion(created.onboarding_version),
      };
    }

    // Preserve an already-assigned version if a row was created without one.
    if (!data.onboarding_version) {
      const { data: patched, error: patchError } = await supabase
        .from("onboarding_progress")
        .update({ onboarding_version: onboardingVersion })
        .eq("user_id", userId)
        .select()
        .single();
      if (patchError) {
        throw new Error(`Unable to persist onboarding version: ${patchError.message}`);
      }
      return {
        ...patched,
        onboarding_version: normalizeOnboardingVersion(patched.onboarding_version),
      };
    }

    return {
      ...data,
      onboarding_version: normalizeOnboardingVersion(data.onboarding_version),
    };
  });

export const setStepStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { step: number; status: StepStatus; advance?: boolean }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const onboardingVersion = await getOrAssignOnboardingVersion(supabase, userId);

    if (!Number.isInteger(data.step) || data.step < 1 || data.step > 20) {
      throw new Error("Invalid onboarding step.");
    }

    if (onboardingVersion === ACCOUNT_TYPE_ONBOARDING_VERSION) {
      const accountType = await loadV2AccountType(supabase, userId);
      const flow = v2FlowForAccount(accountType);
      const maxStep = flow[flow.length - 1]?.step ?? 1;
      if (data.step > maxStep) {
        throw new Error("That onboarding step is not part of this account route.");
      }
    }

    const { data: current, error: readError } = await supabase
      .from("onboarding_progress")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (readError) {
      throw new Error(`Unable to read onboarding progress: ${readError.message}`);
    }

    const states = {
      ...((current?.step_states as Record<string, StepStatus>) ?? {}),
      [String(data.step)]: data.status,
    };

    const currentStep = data.advance
      ? Math.max(current?.current_step ?? 1, data.step + 1)
      : (current?.current_step ?? data.step);

    // Normal step advancement never completes onboarding. Only trusted completion
    // functions may set overall_status = COMPLETED.
    const preservedVersion = normalizeOnboardingVersion(
      current?.onboarding_version ?? onboardingVersion,
    );

    const { data: updated, error: updateError } = await supabase
      .from("onboarding_progress")
      .upsert(
        {
          user_id: userId,
          current_step: currentStep,
          step_states: states,
          overall_status: "IN_PROGRESS",
          onboarding_version: preservedVersion,
        },
        { onConflict: "user_id" },
      )
      .select()
      .single();

    if (updateError) {
      throw new Error(`Unable to update onboarding progress: ${updateError.message}`);
    }

    if (!updated) {
      throw new Error("Onboarding progress update returned no record.");
    }

    return {
      ...updated,
      onboarding_version: normalizeOnboardingVersion(updated.onboarding_version),
    };
  });

export const completeOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const onboardingVersion = await getOrAssignOnboardingVersion(supabase, userId);
    if (onboardingVersion === ACCOUNT_TYPE_ONBOARDING_VERSION) {
      throw new Error("v2 accounts must complete route-specific onboarding.");
    }

    const { error: profileError } = await supabase
      .from("client_profiles")
      .update({ onboarding_completed: true })
      .eq("user_id", userId);

    if (profileError) {
      throw new Error(`Failed to complete onboarding profile: ${profileError.message}`);
    }

    const { data: progress } = await supabase
      .from("onboarding_progress")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    const states = {
      ...((progress?.step_states as Record<string, string>) ?? {}),
      "8": "COMPLETED",
    };

    const { error: progressError } = await supabase
      .from("onboarding_progress")
      .update({
        current_step: 9,
        step_states: states,
        overall_status: "COMPLETED",
        onboarding_version: normalizeOnboardingVersion(progress?.onboarding_version ?? "v1"),
      })
      .eq("user_id", userId);

    if (progressError) {
      throw new Error(`Failed to update onboarding progress: ${progressError.message}`);
    }

    return { ok: true };
  });

async function assertV2CompletionRequirements(
  supabase: Parameters<typeof getOrAssignOnboardingVersion>[0],
  userId: string,
  accountType: V2AccountType,
) {
  const { data: profile } = await supabase
    .from("client_profiles")
    .select(
      "legal_name, full_name, company_name, country, onboarding_account_type, onboarding_version",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (!profile || profile.onboarding_version !== ONBOARDING_V2) {
    throw new Error("V2 onboarding profile not found.");
  }
  if (!profile.legal_name?.trim() && !profile.full_name?.trim()) {
    throw new Error("Complete your profile before finishing onboarding.");
  }
  if (!profile.country?.trim()) {
    throw new Error("Country is required before finishing onboarding.");
  }
  if (
    (accountType === "enterprise" || accountType === "production_house") &&
    !profile.company_name?.trim()
  ) {
    throw new Error("Company / production house name is required.");
  }

  // Veriff identity verification is NOT an onboarding completion requirement:
  // the Veriff step was removed from signup onboarding. Government-identity
  // claims, DMCA authorization, rights-holder verification and production
  // enforcement eligibility still evaluate KYC separately via requiresVeriff().


  if (requiresRepresentative(accountType)) {
    const { data: representative } = await supabase
      .from("onboarding_v2_evidence")
      .select("id, status")
      .eq("user_id", userId)
      .eq("evidence_type", "representative")
      .in("status", ["SUBMITTED", "VERIFIED"])
      .maybeSingle();
    if (!representative) {
      throw new Error("Representative details are required for this account type.");
    }
  }

  const evidenceType = primaryEvidenceTypeForAccount(accountType);
  if (evidenceType) {
    const { data: evidence } = await supabase
      .from("onboarding_v2_evidence")
      .select("id, status")
      .eq("user_id", userId)
      .eq("evidence_type", evidenceType)
      .in("status", ["SUBMITTED", "VERIFIED"])
      .maybeSingle();
    if (!evidence) {
      throw new Error("Required route evidence has not been submitted.");
    }
  }

  if (requiresFaceProtection(accountType)) {
    const { data: face } = await supabase
      .from("protected_face_profiles")
      .select("status")
      .eq("user_id", userId)
      .maybeSingle();
    if (face?.status !== "FACE_VERIFIED" && face?.status !== "DEFERRED") {
      throw new Error("Face protection must be completed or deferred.");
    }
  }

  const { data: assets } = await supabase
    .from("digital_assets")
    .select("id, verification_status")
    .eq("user_id", userId);
  if (!(assets ?? []).some((asset) => asset.verification_status === "VERIFIED")) {
    throw new Error("At least one verified digital asset is required.");
  }

  const { data: auth } = await supabase
    .from("client_authorizations")
    .select("id, status")
    .eq("user_id", userId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!auth || auth.status !== "ACTIVE") {
    throw new Error("Authorization must be signed and active.");
  }

  const { data: scopes } = await supabase
    .from("authorization_scopes")
    .select("granted")
    .eq("authorization_id", auth.id);
  if (!(scopes ?? []).some((scope) => scope.granted)) {
    throw new Error("At least one authorization scope must be granted.");
  }

  const { data: cert } = await supabase
    .from("verification_certificates")
    .select("id, status")
    .eq("user_id", userId)
    .eq("status", "ACTIVE")
    .order("issued_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!cert) {
    throw new Error("An active verification certificate is required.");
  }
}

export const completeV2Onboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const onboardingVersion = await getOrAssignOnboardingVersion(supabase, userId);
    if (onboardingVersion !== ACCOUNT_TYPE_ONBOARDING_VERSION) {
      throw new Error("This route is only available to v2 accounts.");
    }

    const accountType = await loadV2AccountType(supabase, userId);
    if (!accountType) {
      throw new Error("Choose an account type before completing onboarding.");
    }

    await assertV2CompletionRequirements(supabase, userId, accountType);

    const badge = V2_BADGES[accountType];
    const method = V2_VERIFICATION_METHODS[accountType];

    // Never grant Government Identity Verified to non-individual accounts.
    const profilePatch: {
      onboarding_completed: boolean;
      verification_badge: string;
      onboarding_step: number;
    } = {
      onboarding_completed: true,
      verification_badge: badge,
      onboarding_step: 10,
    };

    const { error: profileError } = await supabase
      .from("client_profiles")
      .update(profilePatch)
      .eq("user_id", userId)
      .eq("onboarding_version", ONBOARDING_V2);
    if (profileError) throw new Error(profileError.message);

    const { data: cert } = await supabase
      .from("verification_certificates")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "ACTIVE")
      .order("issued_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (cert) {
      await supabase
        .from("verification_certificates")
        .update({
          account_type: accountType,
          verification_method: method,
          verification_badge: badge,
        })
        .eq("id", cert.id)
        .eq("user_id", userId);
    }

    const flow = v2FlowForAccount(accountType);
    const states: Record<string, string> = {};
    for (const step of flow) states[String(step.step)] = "COMPLETED";

    const { error: progressError } = await supabase.from("onboarding_progress").upsert(
      {
        user_id: userId,
        current_step: 10,
        overall_status: "COMPLETED",
        step_states: states,
        onboarding_version: ONBOARDING_V2,
      },
      { onConflict: "user_id" },
    );
    if (progressError) throw new Error(progressError.message);

    return { ok: true, account_type: accountType, verification_badge: badge };
  });
