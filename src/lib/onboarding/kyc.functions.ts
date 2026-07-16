import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createHmac } from "crypto";

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

    const payload = {
      verification: {
        callback: `${process.env.PUBLIC_APP_URL ?? ""}/api/public/veriff-webhook`,
        person: { firstName, lastName },
        vendorData: userId,
        timestamp: new Date().toISOString(),
      },
    };
    const body = JSON.stringify(payload);
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    const res = await fetch(`${baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-auth-client": apiKey, "x-hmac-signature": signature },
      body,
    });
    if (!res.ok) throw new Error(`Veriff error ${res.status}: ${await res.text()}`);
    const json = await res.json() as { verification?: { id?: string; url?: string; sessionToken?: string } };
    const veriff_session_id = json.verification?.id ?? null;
    const session_url = json.verification?.url ?? null;

    await supabase.from("kyc_verifications").upsert({
      user_id: userId,
      client_id: (profile as { client_id?: string | null } | null)?.client_id ?? null,
      veriff_session_id: veriff_session_id ?? undefined,
      session_url,
      verification_status: "SESSION_CREATED",
    } as never, { onConflict: "veriff_session_id" });

    return { session_url, veriff_session_id };
  });

export const getKycStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase.from("kyc_verifications").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    return data;
  });
