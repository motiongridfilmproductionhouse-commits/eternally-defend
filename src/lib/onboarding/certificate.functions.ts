import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getMyCertificate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("verification_certificates")
      .select("*")
      .eq("user_id", userId)
      .order("issued_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data;
  });

export const getCertificateSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { certificate_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: cert } = await supabase
      .from("verification_certificates")
      .select("*")
      .eq("id", data.certificate_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!cert?.s3_key) throw new Error("Not found");
    const { getSignedGetUrl } = await import("@/lib/aws/s3.server");
    return { url: await getSignedGetUrl(cert.s3_key, 300) };
  });

export const getPublicVerification = createServerFn({ method: "GET" })
  .inputValidator((d: { slug: string }) => d)
  .handler(async ({ data }) => {
    // Public certificate lookup runs server-side with the trusted client so the
    // underlying SECURITY DEFINER function does not need to be anon-executable.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await (supabaseAdmin as any).rpc("get_public_verification", {
      _slug: data.slug,
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) return { status: "NOT_FOUND" as const };
    return row;
  });

