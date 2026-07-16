import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ProfileSchema = z.object({
  legal_name: z.string().trim().min(1).max(200),
  display_name: z.string().trim().max(200).optional().nullable(),
  company_name: z.string().trim().max(200).optional().nullable(),
  role_title: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  country: z.string().trim().max(80).optional().nullable(),
  address: z.string().trim().max(500).optional().nullable(),
  client_type: z.enum(["individual", "creator", "celebrity", "business", "corporate", "agency"]),
});

async function ensureClientId(supabase: any, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("client_profiles")
    .select("client_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to check existing Client ID: ${error.message}`);
  }

  if (data?.client_id) {
    return data.client_id;
  }

  const timestampPart = Date.now().toString().slice(-6);
  const randomPart = crypto.randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase();

  return `ET-${timestampPart}-${randomPart}`;
}

export const saveClientProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.infer<typeof ProfileSchema>) => ProfileSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const client_id = await ensureClientId(supabase, userId);
    const { data: existing } = await supabase.from("client_profiles").select("user_id, email").eq("user_id", userId).maybeSingle();
    const { data: userInfo } = await supabase.auth.getUser();
    const email = existing?.email ?? userInfo.user?.email ?? null;
    const patch = {
      user_id: userId,
      client_id,
      email,
      email_verified_at: userInfo.user?.email_confirmed_at ?? new Date().toISOString(),
      ...data,
    };
    const { data: row, error } = await supabase.from("client_profiles").upsert({ ...patch, full_name: data.legal_name } as never, { onConflict: "user_id" }).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

export const getClientProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase.from("client_profiles").select("*").eq("user_id", userId).maybeSingle();
    return data;
  });
