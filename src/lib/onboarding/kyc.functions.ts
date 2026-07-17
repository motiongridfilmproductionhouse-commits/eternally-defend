import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createHmac } from "crypto";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type VeriffSessionResult = {
  session_url: string | null;
  veriff_session_id: string | null;
  error: string | null;
};

export const createVeriffSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const apiKey = process.env.VERIFF_API_KEY;
    const secret = process.env.VERIFF_SHARED_SECRET;
    const baseUrl = process.env.VERIFF_BASE_URL ?? "https://stationapi.veriff.com";
    if (!apiKey || !secret) throw new Error("Veriff not configured");

    const { data: profile } = await supabase.from("client_profiles").select("client_id, full_name").eq("user_id", userId).maybeSingle();
    const fullName = (profile as { full_name?: string | null } | null)?.full_name ?? "Client User";
    const [firstName, ...rest] = fullName.split(" ");
    const lastName = rest.join(" ") || "User";
    const requestOrigin = new URL(getRequest().url).origin;
    const configuredOrigin = process.env.PUBLIC_APP_URL?.replace(/\/$/, "");
    const callbackOrigin = configuredOrigin?.startsWith("https://")
      ? configuredOrigin
      : requestOrigin.startsWith("https://")
        ? requestOrigin
        : "https://eternally-defend.lovable.app";

    const payload = {
      verification: {
        callback: `${callbackOrigin}/api/public/veriff-webhook`,
        person: { firstName, lastName },
        vendorData: userId,
        timestamp: new Date().toISOString(),
      },
    };
    const body = JSON.stringify(payload);
    const res = await fetch(`${baseUrl}/v1/sessions`, {
      method: "POST",
      // Veriff explicitly exempts POST /v1/sessions from HMAC signing.
      headers: { "content-type": "application/json", "x-auth-client": apiKey },
      body,
    });
    if (!res.ok) {
      const providerMessage = await res.text();
      console.error("Veriff session creation failed", { status: res.status, response: providerMessage });
      return {
        session_url: null,
        veriff_session_id: null,
        error: "Identity verification is temporarily unavailable. Please try again.",
      } satisfies VeriffSessionResult;
    }
    const json = await res.json() as { verification?: { id?: string; url?: string; sessionToken?: string } };
    const veriff_session_id = json.verification?.id ?? null;
    const session_url = json.verification?.url ?? null;

    if (!veriff_session_id || !session_url) {
      console.error("Veriff returned an incomplete session response", {
        hasSessionId: Boolean(veriff_session_id),
        hasSessionUrl: Boolean(session_url),
      });
      return {
        session_url: null,
        veriff_session_id: null,
        error: "Identity verification did not return a usable session. Please try again.",
      } satisfies VeriffSessionResult;
    }

    const { error: persistenceError } = await supabase.from("kyc_verifications").upsert({
      user_id: userId,
      client_id: (profile as { client_id?: string | null } | null)?.client_id ?? null,
      veriff_session_id,
      session_url,
      verification_status: "SESSION_CREATED",
    } as never, { onConflict: "veriff_session_id" });

    if (persistenceError) {
      console.error("Failed to persist Veriff session", { message: persistenceError.message });
      return {
        session_url: null,
        veriff_session_id: null,
        error: "The verification session could not be saved. Please try again.",
      } satisfies VeriffSessionResult;
    }

    return { session_url, veriff_session_id, error: null } satisfies VeriffSessionResult;
  });

export const getKycStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase.from("kyc_verifications").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    return data;
  });
