import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const SOCIAL_PLATFORMS = [
  "instagram",
  "facebook",
  "x",
  "tiktok",
  "youtube",
  "linkedin",
  "threads",
  "other",
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

const LinkSchema = z.object({
  platform: z.enum(SOCIAL_PLATFORMS),
  url: z.string().trim().url({ message: "Enter a full profile URL" }).max(500),
  label: z.string().trim().max(120).optional(),
});

export type SocialProfileLink = z.infer<typeof LinkSchema>;

const PayloadSchema = z.object({ links: z.array(LinkSchema).max(30) });

/** Official public profile links supplied by the client. No OAuth, no ownership proof. */
export const getSocialProfileLinks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("client_profiles")
      .select("social_profiles")
      .eq("user_id", userId)
      .maybeSingle();
    const raw = (data?.social_profiles ?? {}) as { links?: unknown };
    const parsed = z.array(LinkSchema).safeParse(raw.links ?? []);
    return { links: parsed.success ? parsed.data : [] };
  });

export const saveSocialProfileLinks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.infer<typeof PayloadSchema>) => PayloadSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("client_profiles")
      .select("social_profiles")
      .eq("user_id", userId)
      .maybeSingle();
    const existing = (profile?.social_profiles ?? {}) as Record<string, unknown>;
    const { error } = await supabase
      .from("client_profiles")
      .update({ social_profiles: { ...existing, links: data.links } })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { links: data.links };
  });
