import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createHash } from "crypto";
import { CONSENT_VERSION, ONBOARDING_VERSION } from "./onboarding-versions";

type Json = Record<string, unknown>;

function clientMeta() {
  const req = getRequest();
  const h = req?.headers;
  const ip =
    h?.get("x-forwarded-for")?.split(",")[0].trim() ||
    h?.get("cf-connecting-ip") ||
    h?.get("x-real-ip") ||
    null;
  const ua = h?.get("user-agent") ?? null;
  return { ip, ua };
}

export const getOnboardingState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [profile, assets, activeAuth, docs] = await Promise.all([
      supabase.from("client_profiles").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("onboarding_assets").select("*").eq("user_id", userId).order("created_at"),
      supabase
        .from("authorization_records")
        .select("*")
        .eq("user_id", userId)
        .eq("active", true)
        .order("signed_at", { ascending: false })
        .maybeSingle(),
      supabase.from("enterprise_documents").select("*").eq("user_id", userId).order("uploaded_at"),
    ]);
    return {
      profile: profile.data ?? null,
      assets: assets.data ?? [],
      authorization: activeAuth.data ?? null,
      documents: docs.data ?? [],
      versions: { onboarding: ONBOARDING_VERSION, consent: CONSENT_VERSION },
    };
  });

export const upsertClientProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { step: number; patch: Json }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { ip, ua } = clientMeta();
    const patch: Json = {
      ...data.patch,
      user_id: userId,
      onboarding_step: data.step,
      onboarding_version: ONBOARDING_VERSION,
    };
    const { data: row, error } = await supabase
      .from("client_profiles")
      .upsert(patch, { onConflict: "user_id" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    await supabase.from("onboarding_audit_log").insert({
      user_id: userId,
      event_type: "step_saved",
      step: data.step,
      payload: data.patch as never,
      ip_address: ip,
      user_agent: ua,
    });
    return row;
  });

export const addProtectedAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      asset_kind:
        | "name" | "brand" | "company" | "product" | "social_account"
        | "youtube_channel" | "website" | "logo" | "image" | "video" | "copyright";
      label: string;
      value?: string | null;
      url?: string | null;
      storage_path?: string | null;
      metadata?: Json;
    }) => data,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("onboarding_assets")
      .insert({
        user_id: userId,
        asset_kind: data.asset_kind,
        label: data.label,
        value: data.value ?? null,
        url: data.url ?? null,
        storage_path: data.storage_path ?? null,
        metadata: (data.metadata ?? {}) as never,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const removeProtectedAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("onboarding_assets")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const recordEnterpriseDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      doc_type: "authorization_letter" | "agency_agreement" | "power_of_attorney" | "brand_protection";
      storage_path: string;
      filename: string;
      mime?: string;
      size_bytes?: number;
    }) => data,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("enterprise_documents")
      .insert({
        user_id: userId,
        doc_type: data.doc_type,
        storage_path: data.storage_path,
        filename: data.filename,
        mime: data.mime ?? null,
        size_bytes: data.size_bytes ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const removeEnterpriseDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("enterprise_documents")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const submitAuthorization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      consents: Record<string, boolean>;
      authorization_level:
        | "monitoring" | "monitoring_evidence" | "monitoring_enforcement" | "full_protection";
      legal_name: string;
      signature_text: string;
    }) => data,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const requiredKeys = ["ownership", "monitoring", "enforcement", "platformFinality", "noGuarantee"];
    for (const k of requiredKeys) {
      if (!data.consents[k]) throw new Error(`Consent required: ${k}`);
    }
    if (!data.legal_name.trim() || !data.signature_text.trim()) {
      throw new Error("Legal name and signature are required.");
    }
    const { ip, ua } = clientMeta();
    const signedAt = new Date().toISOString();
    const consentsWithTs: Record<string, { agreed: boolean; at: string }> = {};
    for (const k of requiredKeys) consentsWithTs[k] = { agreed: true, at: signedAt };

    const canonical = JSON.stringify({
      user_id: userId,
      consents: consentsWithTs,
      authorization_level: data.authorization_level,
      legal_name: data.legal_name.trim(),
      signed_at: signedAt,
      consent_version: CONSENT_VERSION,
    });
    const signature_hash = createHash("sha256").update(canonical).digest("hex");

    // Deactivate prior records
    await supabase
      .from("authorization_records")
      .update({ active: false })
      .eq("user_id", userId)
      .eq("active", true);

    const { data: rec, error } = await supabase
      .from("authorization_records")
      .insert({
        user_id: userId,
        consent_version: CONSENT_VERSION,
        onboarding_version: ONBOARDING_VERSION,
        consents: consentsWithTs as never,
        authorization_level: data.authorization_level,
        legal_name: data.legal_name.trim(),
        signature_text: data.signature_text.trim(),
        signed_at: signedAt,
        ip_address: ip,
        user_agent: ua,
        signature_hash,
        active: true,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    // Determine authorization_status
    const { data: profile } = await supabase
      .from("client_profiles")
      .select("client_type")
      .eq("user_id", userId)
      .maybeSingle();
    const isEnterprise =
      profile?.client_type === "business" ||
      profile?.client_type === "corporate" ||
      profile?.client_type === "agency";

    await supabase
      .from("client_profiles")
      .update({
        onboarding_completed: true,
        onboarding_step: 8,
        authorization_level: data.authorization_level,
        authorization_status: isEnterprise ? "enterprise_authorized" : "authorized",
      })
      .eq("user_id", userId);

    await supabase.from("onboarding_audit_log").insert({
      user_id: userId,
      event_type: "authorization_signed",
      step: 6,
      payload: { authorization_id: rec.id, signature_hash } as never,
      ip_address: ip,
      user_agent: ua,
    });

    return rec;
  });
