import {
  ONBOARDING_V2,
  isLightVerificationAccount,
  isV2AccountType,
  v2FlowForAccount,
} from "./v2-config";

type SupabaseLike = {
  from: (table: string) => any;
};

/**
 * Marks friction-light onboarding as complete so the account can reach the
 * dashboard and start monitoring while still UNVERIFIED.
 *
 * Deliberate invariants:
 * - no verification badge is written (account type is self-declared)
 * - authorization_status stays `pending`, so enforcement remains gated
 * - only monitoring authorization level is granted
 */
export async function finishLightOnboardingForUser(supabase: SupabaseLike, userId: string) {
  const { data: profile, error: readError } = await supabase
    .from("client_profiles")
    .select(
      "onboarding_version, onboarding_account_type, legal_name, full_name, country, verification_badge",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);

  const accountType = isV2AccountType(profile?.onboarding_account_type)
    ? profile.onboarding_account_type
    : null;

  if (profile?.onboarding_version !== ONBOARDING_V2 || !accountType) {
    throw new Error("Select an account type before finishing setup.");
  }
  if (!isLightVerificationAccount(accountType)) {
    throw new Error("This account type uses the full verification route.");
  }
  if (!profile.legal_name?.trim() && !profile.full_name?.trim()) {
    throw new Error("Add your name before finishing setup.");
  }
  if (!profile.country?.trim()) {
    throw new Error("Add your country before finishing setup.");
  }

  const flow = v2FlowForAccount(accountType);
  const lastStep = flow[flow.length - 1]?.step ?? 3;

  const { error: profileError } = await supabase
    .from("client_profiles")
    .update({
      onboarding_completed: true,
      onboarding_step: lastStep,
      authorization_level: "monitoring",
      // Verification is intentionally left untouched: monitoring only.
      verification_badge: profile.verification_badge ?? null,
    })
    .eq("user_id", userId)
    .eq("onboarding_version", ONBOARDING_V2);
  if (profileError) throw new Error(profileError.message);

  const states: Record<string, string> = {};
  for (const step of flow) states[String(step.step)] = "COMPLETED";

  const { error: progressError } = await supabase.from("onboarding_progress").upsert(
    {
      user_id: userId,
      current_step: lastStep,
      overall_status: "COMPLETED",
      step_states: states,
      onboarding_version: ONBOARDING_V2,
    },
    { onConflict: "user_id" },
  );
  if (progressError) throw new Error(progressError.message);

  return { ok: true, account_type: accountType, verification_status: "UNVERIFIED" as const };
}
