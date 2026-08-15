import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeProfileUrl, handleFromProfileUrl } from "./provenance";

/**
 * MODE A shell — authorized Instagram connection.
 *
 * Eterna never asks for or stores a customer's Instagram password. A connection
 * is only possible through Instagram's own authorization screen, which requires
 * an approved Meta app. Until those platform credentials exist this reports
 * `configured: false` and the whole flow stays optional; MODE B still protects.
 */
export const getInstagramConnectStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const configured = Boolean(
      process.env["META_APP_ID"] && process.env["META_APP_SECRET"] && process.env["META_REDIRECT_URI"],
    );
    const { data } = await context.supabase
      .from("social_accounts")
      .select("id,profile_url,handle,mode,connected_at,last_sync_at")
      .eq("user_id", context.userId)
      .eq("platform", "instagram")
      .order("created_at", { ascending: true });
    const accounts = data ?? [];
    return {
      configured,
      connected: accounts.some((a) => a.mode === "AUTHORIZED_CONNECTED"),
      accounts,
      unavailableReason: configured
        ? null
        : "Instagram authorization is not available yet — official app review is pending. Public reference protection is active in the meantime.",
    };
  });

/** Starts the official Instagram authorization redirect once credentials exist. */
export const startInstagramAuthorization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ profileUrl: z.string().min(4).max(500) }).parse(raw))
  .handler(async ({ data, context }) => {
    const appId = process.env["META_APP_ID"];
    const redirectUri = process.env["META_REDIRECT_URI"];
    const profileUrl = normalizeProfileUrl(data.profileUrl);
    if (!profileUrl) throw new Error("Enter your Instagram profile URL first.");

    // Record the intent as a public reference so protection starts immediately,
    // authorized or not.
    await context.supabase.from("social_accounts").upsert(
      {
        user_id: context.userId,
        platform: "instagram",
        profile_url: profileUrl,
        handle: handleFromProfileUrl(profileUrl),
        mode: "PUBLIC_REFERENCE",
      },
      { onConflict: "user_id,platform,profile_url" },
    );

    if (!appId || !redirectUri) {
      return {
        status: "unavailable" as const,
        authorizationUrl: null,
        message:
          "Instagram authorization is not enabled yet. Your profile is protected in public reference mode.",
      };
    }

    const url = new URL("https://www.instagram.com/oauth/authorize");
    url.searchParams.set("client_id", appId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "instagram_business_basic");
    url.searchParams.set("state", context.userId);
    return { status: "ready" as const, authorizationUrl: url.toString(), message: null };
  });
