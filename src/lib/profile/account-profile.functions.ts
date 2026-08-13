import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Settings account fields the signed-in user may edit for THEIR OWN profile.
 * Every query below is scoped by `context.userId` — never by row order,
 * client_id or any client-supplied identifier.
 */
const AccountProfileSchema = z.object({
  legal_name: z.string().trim().min(1, "Full name is required").max(200),
  display_name: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  country: z.string().trim().max(80).optional().nullable(),
  company_name: z.string().trim().max(200).optional().nullable(),
  role_title: z.string().trim().max(120).optional().nullable(),
});

export type AccountProfileInput = z.infer<typeof AccountProfileSchema>;

/** Reads the authenticated user's own profile row, or null when none exists. */
export const getAccountProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("client_profiles")
      .select(
        "user_id, client_id, legal_name, full_name, display_name, email, phone, country, address, client_type, company_name, company_brand_name, role_title, onboarding_account_type, onboarding_completed, social_profiles",
      )
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { profile: data ?? null, email: context.claims?.email ?? null };
  });

/** Updates only the authenticated user's own profile row. */
export const updateAccountProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => AccountProfileSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: existing, error: readError } = await supabase
      .from("client_profiles")
      .select("user_id, onboarding_account_type, client_type")
      .eq("user_id", userId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!existing) {
      throw new Error("Complete onboarding before editing your profile.");
    }

    const personalAccount =
      existing.onboarding_account_type === "celebrity" ||
      existing.onboarding_account_type === "individual" ||
      (!existing.onboarding_account_type &&
        ["celebrity", "individual", "creator"].includes(existing.client_type ?? ""));

    const patch: Record<string, string | null> = {
      legal_name: data.legal_name.trim(),
      full_name: data.legal_name.trim(),
      display_name: data.display_name?.trim() || null,
      phone: data.phone?.trim() || null,
      country: data.country?.trim() || null,
    };
    // Personal accounts never persist organizational identity from Settings.
    if (!personalAccount) {
      patch["company_name"] = data.company_name?.trim() || null;
      patch["role_title"] = data.role_title?.trim() || null;
    }

    const { data: row, error } = await supabase
      .from("client_profiles")
      .update(patch as never)
      .eq("user_id", userId)
      .select(
        "user_id, client_id, legal_name, full_name, display_name, email, phone, country, address, client_type, company_name, company_brand_name, role_title, onboarding_account_type, onboarding_completed, social_profiles",
      )
      .single();
    if (error) throw new Error(error.message);
    return row;
  });
