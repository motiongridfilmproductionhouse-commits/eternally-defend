import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export const getMyCertificate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase.from("verification_certificates").select("*").eq("user_id", userId).order("issued_at", { ascending: false }).limit(1).maybeSingle();
    return data;
  });

export const getCertificateSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { certificate_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: cert } = await supabase.from("verification_certificates").select("*").eq("id", data.certificate_id).eq("user_id", userId).maybeSingle();
    if (!cert?.s3_key) throw new Error("Not found");
    const { getSignedGetUrl } = await import("@/lib/aws/s3.server");
    return { url: await getSignedGetUrl(cert.s3_key, 300) };
  });

export const getPublicVerification = createServerFn({ method: "GET" })
  .inputValidator((d: { slug: string }) => d)
  .handler(async ({ data }) => {
    const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
    const url = process.env.SUPABASE_URL!;
    const client = createClient<Database>(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => {
          const h = new Headers(init?.headers);
          if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
          h.set("apikey", key);
          return fetch(input, { ...init, headers: h });
        },
      },
    });
    const { data: rows } = await client.rpc("get_public_verification" as never, { _slug: data.slug } as never);
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) return { status: "NOT_FOUND" as const };
    return row;
  });
