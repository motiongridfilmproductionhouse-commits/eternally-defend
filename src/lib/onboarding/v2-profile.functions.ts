import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  ONBOARDING_V2,
  V2_ACCOUNT_TYPES,
  V2_BADGES,
  clientTypeForV2,
  legacyAccountTypeForV2,
} from "./v2-config";

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

async function getClientId(supabase: any, userId: string) {
  const { data } = await supabase
    .from("client_profiles")
    .select("client_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (data?.client_id) return data.client_id;
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  return `ET-${Date.now().toString().slice(-6)}-${suffix}`;
}

export const selectV2AccountType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: z.infer<typeof SelectAccountSchema>) => SelectAccountSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: existing, error: readError } = await supabase
      .from("client_profiles")
      .select("onboarding_version, onboarding_account_type, client_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (existing?.onboarding_version === "v1") {
      throw new Error("This account uses the legacy onboarding flow and cannot be migrated.");
    }
    if (existing?.onboarding_account_type && existing.onboarding_account_type !== data.account_type) {
      throw new Error("Account type is locked after onboarding begins.");
    }

    const clientId = existing?.client_id ?? await getClientId(supabase, userId);
    const { data: userInfo } = await supabase.auth.getUser();
    const { data: row, error } = await supabase.from("client_profiles").upsert({
      user_id: userId,
      client_id: clientId,
      email: userInfo.user?.email ?? null,
      email_verified_at: userInfo.user?.email_confirmed_at ?? null,
      onboarding_version: ONBOARDING_V2,
      onboarding_account_type: data.account_type,
      verification_badge: V2_BADGES[data.account_type],
      client_type: clientTypeForV2(data.account_type),
      account_type: legacyAccountTypeForV2(data.account_type),
      onboarding_step: 1,
    } as never, { onConflict: "user_id" }).select().single();
    if (error) throw new Error(error.message);

    const { error: progressError } = await supabase.from("onboarding_progress").upsert({
      user_id: userId,
      current_step: 1,
      overall_status: "IN_PROGRESS",
      step_states: {},
      onboarding_version: ONBOARDING_V2,
    }, { onConflict: "user_id" });
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

    const { data: row, error } = await supabase.from("client_profiles").update({
      ...data,
      full_name: data.legal_name,
      onboarding_step: 2,
    } as never).eq("user_id", userId).eq("onboarding_version", ONBOARDING_V2).select().single();
    if (error) throw new Error(error.message);
    return row;
  });