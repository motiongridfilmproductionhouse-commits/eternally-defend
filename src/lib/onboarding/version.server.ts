import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export const LEGACY_ONBOARDING_VERSION = "v1" as const;
export const ACCOUNT_TYPE_ONBOARDING_VERSION = "v2" as const;

export type OnboardingVersion =
  | typeof LEGACY_ONBOARDING_VERSION
  | typeof ACCOUNT_TYPE_ONBOARDING_VERSION;

type AppSupabase = SupabaseClient<Database>;

export function accountTypeOnboardingIsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ACCOUNT_TYPE_ONBOARDING_ENABLED?.trim().toLowerCase() === "true";
}

export function accountTypeOnboardingActivationAt(
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  const raw = env.ACCOUNT_TYPE_ONBOARDING_ACTIVATION_AT?.trim();
  if (!raw) return null;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function assignVersionForNewAccount(
  createdAt: string,
  env: NodeJS.ProcessEnv = process.env,
): OnboardingVersion {
  const activationAt = accountTypeOnboardingActivationAt(env);
  const createdAtMs = Date.parse(createdAt);
  if (
    accountTypeOnboardingIsEnabled(env) &&
    activationAt !== null &&
    Number.isFinite(createdAtMs) &&
    createdAtMs >= activationAt
  ) {
    return ACCOUNT_TYPE_ONBOARDING_VERSION;
  }
  return LEGACY_ONBOARDING_VERSION;
}

export function normalizeOnboardingVersion(value: unknown): OnboardingVersion {
  return value === ACCOUNT_TYPE_ONBOARDING_VERSION
    ? ACCOUNT_TYPE_ONBOARDING_VERSION
    : LEGACY_ONBOARDING_VERSION;
}

export async function getOrAssignOnboardingVersion(
  supabase: AppSupabase,
  userId: string,
): Promise<OnboardingVersion> {
  // Progress is the first trusted write for new accounts (via getProgress).
  const { data: progress, error: progressError } = await supabase
    .from("onboarding_progress")
    .select("onboarding_version")
    .eq("user_id", userId)
    .maybeSingle();
  if (progressError) {
    throw new Error(`Unable to resolve onboarding version: ${progressError.message}`);
  }
  if (progress?.onboarding_version) {
    return normalizeOnboardingVersion(progress.onboarding_version);
  }

  const { data: profile, error: profileError } = await supabase
    .from("client_profiles")
    .select("onboarding_version, onboarding_account_type, onboarding_completed")
    .eq("user_id", userId)
    .maybeSingle();
  if (profileError) {
    throw new Error(`Unable to resolve onboarding version: ${profileError.message}`);
  }
  // Only trust profile version once the account has entered a specific route or finished.
  if (
    profile &&
    (profile.onboarding_account_type ||
      profile.onboarding_completed ||
      normalizeOnboardingVersion(profile.onboarding_version) === ACCOUNT_TYPE_ONBOARDING_VERSION)
  ) {
    return normalizeOnboardingVersion(profile.onboarding_version);
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    throw new Error("Unable to resolve authenticated account creation time.");
  }

  const version = assignVersionForNewAccount(authData.user.created_at, process.env);
  const { error: insertError } = await supabase.from("onboarding_progress").insert({
    user_id: userId,
    current_step: 1,
    overall_status: "IN_PROGRESS",
    step_states: {},
    onboarding_version: version,
  });
  if (insertError && !/duplicate|unique/i.test(insertError.message)) {
    throw new Error(`Unable to assign onboarding version: ${insertError.message}`);
  }

  return version;
}

/** Merge a progress patch while always preserving onboarding_version. */
export async function upsertProgressPreservingVersion(
  supabase: AppSupabase,
  userId: string,
  patch: {
    current_step?: number;
    step_states?: Record<string, string>;
    overall_status?: Database["public"]["Enums"]["onboarding_overall_status"];
  },
) {
  const version = await getOrAssignOnboardingVersion(supabase, userId);
  const { data: current } = await supabase
    .from("onboarding_progress")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  const { data, error } = await supabase
    .from("onboarding_progress")
    .upsert(
      {
        user_id: userId,
        current_step: patch.current_step ?? current?.current_step ?? 1,
        step_states: patch.step_states ?? current?.step_states ?? {},
        overall_status:
          patch.overall_status ??
          (current?.overall_status === "COMPLETED" ? "COMPLETED" : "IN_PROGRESS"),
        onboarding_version: normalizeOnboardingVersion(current?.onboarding_version ?? version),
      },
      { onConflict: "user_id" },
    )
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function requireOnboardingVersion(
  supabase: AppSupabase,
  userId: string,
  expected: OnboardingVersion,
): Promise<OnboardingVersion> {
  const version = await getOrAssignOnboardingVersion(supabase, userId);
  if (version !== expected) {
    throw new Error(
      expected === "v2"
        ? "This route is only available to v2 accounts."
        : "This route is only available to legacy onboarding accounts.",
    );
  }
  return version;
}
