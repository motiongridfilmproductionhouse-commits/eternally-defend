import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getOrAssignOnboardingVersion } from "./version.server";

export const AccountTypeSchema = z.enum([
  "celebrity",
  "individual",
  "enterprise",
  "production_house",
]);
export type AccountType = z.infer<typeof AccountTypeSchema>;

export const selectAccountType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AccountTypeSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const version = await getOrAssignOnboardingVersion(supabase, userId);
    if (version !== "v2")
      throw new Error("Account type selection is not available for legacy accounts.");
    const clientType = data === "enterprise" || data === "production_house" ? "business" : data;
    const { data: profile, error } = await supabase
      .from("client_profiles")
      .upsert(
        {
          user_id: userId,
          account_type: data,
          client_type: clientType,
          onboarding_version: "v2",
        } as never,
        { onConflict: "user_id" },
      )
      .select("account_type,onboarding_version")
      .single();
    if (error) throw new Error(error.message);
    return profile;
  });
