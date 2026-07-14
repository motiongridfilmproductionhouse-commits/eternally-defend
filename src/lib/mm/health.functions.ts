/**
 * Provider self-tests + admin health dashboard queries.
 * Each test performs the smallest valid API request, records latency, and
 * NEVER echoes secret values.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type HealthStatus = "active" | "stubbed" | "misconfigured" | "disabled" | "quota_limited" | "temporarily_unavailable";

export interface ProviderTestResult {
  provider: string;
  mode: string;
  status: HealthStatus;
  latency_ms: number | null;
  message: string;
  checked_at: string;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T; error?: string }> {
  const t = Date.now();
  try { const value = await fn(); return { ms: Date.now() - t, value }; }
  catch (e) { return { ms: Date.now() - t, value: null as any, error: e instanceof Error ? e.message : String(e) }; }
}

// ---- Individual tests -------------------------------------------------------

async function testFactCheckProviderImpl(): Promise<ProviderTestResult> {
  const { getProviderConfig } = await import("./providers.server");
  const cfg = getProviderConfig();
  if (cfg.factCheck === "stub" || !cfg.factCheckApiKey) {
    return baseResult("fact_check", cfg.factCheck, "disabled", null, "Fact Check API key not configured");
  }
  const t = await timed(async () => {
    const url = new URL("https://factchecktools.googleapis.com/v1alpha1/claims:search");
    url.searchParams.set("key", cfg.factCheckApiKey!);
    url.searchParams.set("query", "climate change");
    url.searchParams.set("pageSize", "1");
    const r = await fetch(url.toString());
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
  if (t.error) return baseResult("fact_check", cfg.factCheck, /quota|rate/i.test(t.error) ? "quota_limited" : "temporarily_unavailable", t.ms, t.error);
  return baseResult("fact_check", cfg.factCheck, "active", t.ms, "Authenticated request succeeded");
}

async function testTranslationProviderImpl(): Promise<ProviderTestResult> {
  const { getProviderConfig } = await import("./providers.server");
  const cfg = getProviderConfig();
  if (cfg.translation === "stub" || !cfg.googleApiKey) {
    return baseResult("translation", cfg.translation, "disabled", null, "Google API key not configured");
  }
  const t = await timed(async () => {
    const url = new URL("https://translation.googleapis.com/language/translate/v2/detect");
    url.searchParams.set("key", cfg.googleApiKey!);
    const r = await fetch(url.toString(), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ q: "hola mundo" }).toString() });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
  if (t.error) return baseResult("translation", cfg.translation, /quota|rate/i.test(t.error) ? "quota_limited" : "temporarily_unavailable", t.ms, t.error);
  return baseResult("translation", cfg.translation, "active", t.ms, "Language detect returned result");
}

async function testGeminiProviderImpl(): Promise<ProviderTestResult> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return baseResult("gemini_claim_extraction", "lovable_ai_gateway", "misconfigured", null, "LOVABLE_API_KEY not present");
  const t = await timed(async () => {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.5-flash", messages: [{ role: "user", content: "reply with the single word OK" }] }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
  if (t.error) return baseResult("gemini_claim_extraction", "lovable_ai_gateway", /quota|rate|429/i.test(t.error) ? "quota_limited" : "temporarily_unavailable", t.ms, t.error);
  return baseResult("gemini_claim_extraction", "lovable_ai_gateway", "active", t.ms, "Gateway responded");
}

async function testVideoIntelligenceProviderImpl(): Promise<ProviderTestResult> {
  const { getProviderConfig } = await import("./providers.server");
  const cfg = getProviderConfig();
  if (cfg.videoIntelligence === "stub") {
    return baseResult("video_intelligence", cfg.videoIntelligence, "stubbed", null, "Requires service account credentials — blocked by GCP org policy");
  }
  return baseResult("video_intelligence", cfg.videoIntelligence, "misconfigured", null, "Provider mode set but service account activation not implemented in this build");
}

async function testSpeechToTextProviderImpl(): Promise<ProviderTestResult> {
  const { getProviderConfig } = await import("./providers.server");
  const cfg = getProviderConfig();
  if (cfg.speechToText === "stub") return baseResult("speech_to_text", cfg.speechToText, "stubbed", null, "Requires service account credentials");
  return baseResult("speech_to_text", cfg.speechToText, "misconfigured", null, "Provider mode set but service account activation not implemented in this build");
}

async function testVisionProviderImpl(): Promise<ProviderTestResult> {
  const { getProviderConfig } = await import("./providers.server");
  const cfg = getProviderConfig();
  if (cfg.vision === "stub") return baseResult("vision", cfg.vision, "stubbed", null, "Requires service account credentials");
  return baseResult("vision", cfg.vision, "misconfigured", null, "Provider mode set but service account activation not implemented in this build");
}

async function testCloudStorageProviderImpl(): Promise<ProviderTestResult> {
  // Uses Lovable Cloud (Supabase) storage bucket, not GCS — the bucket name env
  // var tracks intended GCS bucket, but authorised uploads live in Supabase
  // Storage until service-account transfer is enabled.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const t = await timed(async () => {
    const { data, error } = await supabaseAdmin.storage.getBucket("multimedia-uploads");
    if (error) throw new Error(error.message);
    return data;
  });
  if (t.error) return baseResult("cloud_storage", "lovable_cloud", "misconfigured", t.ms, t.error);
  return baseResult("cloud_storage", "lovable_cloud", "active", t.ms, "Private bucket reachable");
}

function baseResult(provider: string, mode: string, status: HealthStatus, latency: number | null, message: string): ProviderTestResult {
  return { provider, mode, status, latency_ms: latency, message, checked_at: new Date().toISOString() };
}

// ---- Server functions -------------------------------------------------------

const testers: Record<string, () => Promise<ProviderTestResult>> = {
  fact_check: testFactCheckProviderImpl,
  translation: testTranslationProviderImpl,
  gemini_claim_extraction: testGeminiProviderImpl,
  video_intelligence: testVideoIntelligenceProviderImpl,
  speech_to_text: testSpeechToTextProviderImpl,
  vision: testVisionProviderImpl,
  cloud_storage: testCloudStorageProviderImpl,
};

async function requireAdmin(supabase: any, userId: string) {
  const { data: myRoles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const isAdmin = ((myRoles ?? []) as Array<{ role: string }>).some(
    (r) => r.role === "admin" || r.role === "super_admin",
  );
  if (isAdmin) return;
  // Bootstrap: if there are no admins yet at all, permit so the first user can self-provision.
  const { data: anyAdmin } = await supabase
    .from("user_roles")
    .select("user_id")
    .in("role", ["admin", "super_admin"])
    .limit(1);
  if (!anyAdmin || anyAdmin.length === 0) return;
  throw new Error("Forbidden: admin or super_admin role required");
}

export const testAllMultimediaProviders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Any signed-in user can run health checks against their own reservation;
    // admins can see aggregated history. Individual results are always recorded.
    const { supabase, userId } = context;
    const results: ProviderTestResult[] = [];
    for (const [k, fn] of Object.entries(testers)) {
      try { results.push(await fn()); }
      catch (e) { results.push(baseResult(k, "unknown", "temporarily_unavailable", null, e instanceof Error ? e.message : String(e))); }
    }
    const rows = results.map((r) => ({
      provider: r.provider, mode: r.mode, status: r.status,
      latency_ms: r.latency_ms, error_message: r.status === "active" ? null : r.message,
      diagnostic: { message: r.message }, checked_by: userId,
    }));
    await supabase.from("provider_health_checks").insert(rows);
    return { results };
  });

export const testOneProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ provider: z.enum(Object.keys(testers) as [string, ...string[]]) }).parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const result = await testers[data.provider]();
    await supabase.from("provider_health_checks").insert({
      provider: result.provider, mode: result.mode, status: result.status,
      latency_ms: result.latency_ms, error_message: result.status === "active" ? null : result.message,
      diagnostic: { message: result.message }, checked_by: userId,
    });
    return { result };
  });

export const getMultimediaHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await requireAdmin(supabase, userId);
    const { getProviderConfig } = await import("./providers.server");
    const { getLimits } = await import("./quota.server");
    const cfg = getProviderConfig();
    const limits = getLimits();
    const providers = [
      { key: "fact_check", label: "Fact Check Tools", mode: cfg.factCheck, flag: "MM_PROVIDER_FACT_CHECK", credential: cfg.factCheckApiKey ? "configured" : "missing" },
      { key: "translation", label: "Google Translation", mode: cfg.translation, flag: "MM_PROVIDER_TRANSLATION", credential: cfg.googleApiKey ? "configured" : "missing" },
      { key: "gemini_claim_extraction", label: "Gemini Claim Extraction", mode: "lovable_ai_gateway", flag: "LOVABLE_API_KEY", credential: process.env.LOVABLE_API_KEY ? "configured" : "missing" },
      { key: "video_intelligence", label: "Video Intelligence", mode: cfg.videoIntelligence, flag: "MM_PROVIDER_VIDEO_INTELLIGENCE", credential: cfg.hasServiceAccount ? "configured" : "missing" },
      { key: "speech_to_text", label: "Speech-to-Text", mode: cfg.speechToText, flag: "MM_PROVIDER_SPEECH_TO_TEXT", credential: cfg.hasServiceAccount ? "configured" : "missing" },
      { key: "vision", label: "Vision", mode: cfg.vision, flag: "MM_PROVIDER_VISION", credential: cfg.hasServiceAccount ? "configured" : "missing" },
      { key: "cloud_storage", label: "Cloud Storage", mode: "lovable_cloud", flag: "GOOGLE_CLOUD_STORAGE_BUCKET", credential: cfg.bucket ? "configured" : "missing" },
    ];

    // Aggregate last 24h stats per provider
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: recent } = await supabase.from("provider_health_checks")
      .select("provider, status, latency_ms, error_message, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500);
    const rows = recent ?? [];
    const stats: Record<string, any> = {};
    for (const p of providers) {
      const items = rows.filter((r: any) => r.provider === p.key);
      const success = items.filter((r: any) => r.status === "active").length;
      const total = items.length;
      const latencies = items.map((r: any) => r.latency_ms).filter((n: any) => typeof n === "number");
      const avg = latencies.length ? Math.round(latencies.reduce((a: number, b: number) => a + b, 0) / latencies.length) : null;
      const lastOk = items.find((r: any) => r.status === "active");
      const lastFail = items.find((r: any) => r.status !== "active");
      stats[p.key] = {
        successRate: total ? Math.round((success / total) * 100) : null,
        avgLatencyMs: avg,
        errorCount: total - success,
        lastSuccessAt: lastOk?.created_at ?? null,
        lastFailureAt: lastFail?.created_at ?? null,
        lastFailureReason: lastFail?.error_message ?? null,
        currentAvailability: lastOk && (!lastFail || new Date(lastOk.created_at) > new Date(lastFail.created_at)) ? "up" : total ? "down" : "unknown",
      };
    }

    // Cost/quota snapshot (admin scope: today's total across all users)
    const today = new Date().toISOString().slice(0, 10);
    const { data: usage } = await supabase.from("quota_usage").select("analyses_count, cost_cents, api_calls_count").eq("usage_date", today);
    const usageTotals = (usage ?? []).reduce((acc: any, r: any) => ({
      analyses: acc.analyses + (r.analyses_count ?? 0),
      cost_cents: acc.cost_cents + (r.cost_cents ?? 0),
      api_calls: acc.api_calls + (r.api_calls_count ?? 0),
    }), { analyses: 0, cost_cents: 0, api_calls: 0 });

    return { providers, stats, limits, usageTotals };
  });
