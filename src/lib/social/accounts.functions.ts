import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  SOCIAL_ASSET_PLATFORMS,
  handleFromProfileUrl,
  normalizeProfileUrl,
  platformFromUrl,
  type SocialAccountMode,
  type SocialAssetPlatform,
} from "./provenance";

export interface SocialAccountRow {
  id: string;
  platform: SocialAssetPlatform;
  profile_url: string;
  handle: string | null;
  mode: SocialAccountMode;
  connected_at: string | null;
  last_sync_at: string | null;
  created_at: string;
}

export const listSocialAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("social_accounts")
      .select("id,platform,profile_url,handle,mode,connected_at,last_sync_at,created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return { accounts: (data ?? []) as SocialAccountRow[] };
  });

/**
 * Register an official public profile as a PUBLIC REFERENCE. No login, no token,
 * no ownership verification — it is self-declared and used as a trusted
 * reference for discovery and impersonation comparison only.
 */
export const addPublicReferenceAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        profileUrl: z.string().min(4).max(500),
        platform: z.enum(SOCIAL_ASSET_PLATFORMS).optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const profileUrl = normalizeProfileUrl(data.profileUrl);
    if (!profileUrl) throw new Error("Enter a full public profile URL, e.g. https://instagram.com/yourname");
    const platform = data.platform ?? platformFromUrl(profileUrl);
    const { data: row, error } = await context.supabase
      .from("social_accounts")
      .upsert(
        {
          user_id: context.userId,
          platform,
          profile_url: profileUrl,
          handle: handleFromProfileUrl(profileUrl),
          mode: "PUBLIC_REFERENCE",
        },
        { onConflict: "user_id,platform,profile_url" },
      )
      .select("id,platform,profile_url,handle,mode,connected_at,last_sync_at,created_at")
      .maybeSingle();
    if (error) throw new Error(error.message);

    // Mirror into the onboarding social_profiles blob so the existing
    // authorized-subject allowlist keeps scoping scans to this account.
    const { data: profile } = await context.supabase
      .from("client_profiles")
      .select("social_profiles")
      .eq("user_id", context.userId)
      .maybeSingle();
    const blob = (profile?.social_profiles ?? {}) as Record<string, unknown>;
    const links = Array.isArray(blob.links)
      ? (blob.links as Array<{ platform?: string; url?: string }>)
      : [];
    if (!links.some((link) => link.url === profileUrl)) {
      await context.supabase
        .from("client_profiles")
        .update({ social_profiles: { ...blob, links: [...links, { platform, url: profileUrl }] } as never })
        .eq("user_id", context.userId);
    }

    return { account: row as SocialAccountRow };
  });

export const removeSocialAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("social_accounts")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { removed: true };
  });
