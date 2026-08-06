import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  ONBOARDING_V2,
  V2_ACCOUNT_TYPES,
  clientTypeForV2,
  legacyAccountTypeForV2,
} from "./v2-config";
import { ACCOUNT_TYPE_ONBOARDING_VERSION, getOrAssignOnboardingVersion } from "./version.server";

const SelectAccountSchema = z.object({
  account_type: z.enum(V2_ACCOUNT_TYPES),
});

const V2ProfileSchema = z.object({
  legal_name: z.string().trim().min(1).max(200),
  display_name: z.string().trim().max(200).optional().nullable(),
  company_name: z.string().trim().max(200).optional().nullable(),
  role_title: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  country: z.string().trim().min(1).max(80),
  address: z.string().trim().max(500).optional().nullable(),
});

function newClientId() {
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  return `ET-${Date.now().toString().slice(-6)}-${suffix}`;
}

export const selectV2AccountType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: z.infer<typeof SelectAccountSchema>) => SelectAccountSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const version = await getOrAssignOnboardingVersion(supabase, userId);
    if (version !== ACCOUNT_TYPE_ONBOARDING_VERSION) {
      throw new Error("This account uses the legacy onboarding flow and cannot be migrated.");
    }

    const { data: existing, error: readError } = await supabase
      .from("client_profiles")
      .select("onboarding_version, onboarding_account_type, client_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (existing?.onboarding_version === "v1") {
      throw new Error("This account uses the legacy onboarding flow and cannot be migrated.");
    }
    if (
      existing?.onboarding_account_type &&
      existing.onboarding_account_type !== data.account_type
    ) {
      throw new Error("Account type is locked after onboarding begins.");
    }

    const clientId = existing?.client_id ?? newClientId();
    const { data: userInfo } = await supabase.auth.getUser();
    const { data: row, error } = await supabase
      .from("client_profiles")
      .upsert(
        {
          user_id: userId,
          client_id: clientId,
          email: userInfo.user?.email ?? null,
          email_verified_at: userInfo.user?.email_confirmed_at ?? null,
          onboarding_version: ONBOARDING_V2,
          onboarding_account_type: data.account_type,
          // Badge is awarded only after trusted completion — never at account selection.
          verification_badge: null,
          client_type: clientTypeForV2(data.account_type),
          account_type: legacyAccountTypeForV2(data.account_type),
          onboarding_step: 1,
          onboarding_completed: false,
        },
        { onConflict: "user_id" },
      )
      .select()
      .single();
    if (error) throw new Error(error.message);

    const { data: progress } = await supabase
      .from("onboarding_progress")
      .select("current_step, step_states, overall_status")
      .eq("user_id", userId)
      .maybeSingle();

    const { error: progressError } = await supabase.from("onboarding_progress").upsert(
      {
        user_id: userId,
        current_step: Math.max(progress?.current_step ?? 1, 1),
        overall_status: progress?.overall_status === "COMPLETED" ? "COMPLETED" : "IN_PROGRESS",
        step_states: (progress?.step_states as Record<string, string>) ?? {},
        onboarding_version: ONBOARDING_V2,
      },
      { onConflict: "user_id" },
    );
    if (progressError) throw new Error(progressError.message);
    return row;
  });

export const saveV2ClientProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: z.infer<typeof V2ProfileSchema>) => V2ProfileSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("client_profiles")
      .select("onboarding_version, onboarding_account_type")
      .eq("user_id", userId)
      .maybeSingle();
    if (profile?.onboarding_version !== ONBOARDING_V2 || !profile.onboarding_account_type) {
      throw new Error("Select an account type before saving your profile.");
    }

    const accountType = profile.onboarding_account_type;
    if (
      (accountType === "enterprise" || accountType === "production_house") &&
      !data.company_name?.trim()
    ) {
      throw new Error("Company / production house name is required.");
    }

    const { data: row, error } = await supabase
      .from("client_profiles")
      .update({
        legal_name: data.legal_name,
        full_name: data.legal_name,
        display_name: data.display_name ?? null,
        company_name: data.company_name ?? null,
        role_title: data.role_title ?? null,
        phone: data.phone ?? null,
        country: data.country,
        address: data.address ?? null,
        onboarding_step: 2,
      })
      .eq("user_id", userId)
      .eq("onboarding_version", ONBOARDING_V2)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });
