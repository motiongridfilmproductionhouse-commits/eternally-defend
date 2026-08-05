import type { SupabaseClient } from "@supabase/supabase-js";

export const LEGACY_ONBOARDING_VERSION = "v1" as const;
export const ACCOUNT_TYPE_ONBOARDING_VERSION = "v2" as const;

export type OnboardingVersion =
  typeof LEGACY_ONBOARDING_VERSION | typeof ACCOUNT_TYPE_ONBOARDING_VERSION;

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
  supabase: SupabaseClient,
  userId: string,
): Promise<OnboardingVersion> {
  const { data: profile, error: profileError } = await supabase
    .from("client_profiles")
    .select("onboarding_version")
    .eq("user_id", userId)
    .maybeSingle();
  if (profileError)
    throw new Error(`Unable to resolve onboarding version: ${profileError.message}`);
  if (profile) return normalizeOnboardingVersion(profile.onboarding_version);

  const { data: progress, error: progressError } = await supabase
    .from("onboarding_progress")
    .select("onboarding_version")
    .eq("user_id", userId)
    .maybeSingle();
  if (progressError)
    throw new Error(`Unable to resolve onboarding version: ${progressError.message}`);
  if (progress?.onboarding_version) return normalizeOnboardingVersion(progress.onboarding_version);

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user)
    throw new Error("Unable to resolve authenticated account creation time.");
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

export async function requireOnboardingVersion(
  supabase: SupabaseClient,
  userId: string,
): Promise<OnboardingVersion> {
  return getOrAssignOnboardingVersion(supabase, userId);
}
