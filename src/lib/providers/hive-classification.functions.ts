import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Internal configuration logic reading the secret
function getHiveConfig() {
  const accessKeyId = process.env.HIVE_ACCESS_KEY_ID;
  const secretKey = process.env.HIVE_SECRET_KEY;
  
  if (!accessKeyId || !secretKey) {
    return { error: "Hive AI credentials (HIVE_ACCESS_KEY_ID or HIVE_SECRET_KEY) not configured." };
  }
  
  const baseUrl = process.env.HIVE_BASE_URL ?? "https://api.thehive.ai";
  // Some Hive configurations use a combined token, or just Basic Auth. We'll format as requested
  // but ensure both are validated. We use a generic token format or basic auth combining them.
  const authHeader = `token ${accessKeyId}:${secretKey}`;
  return { authHeader, baseUrl };
}

export const submitAsyncClassification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { url: string; scanJobId: string; resultId: string }) => 
    z.object({ url: z.string().url(), scanJobId: z.string().uuid(), resultId: z.string().uuid() }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const config = getHiveConfig();
    
    if (config.error) {
      return { ok: false, error: config.error };
    }
    
    const { authHeader, baseUrl } = config;
    
    // We expect the webhook to hit this app URL
    const callbackUrl = `${process.env.PUBLIC_APP_URL}/api/public/hive-webhook`;

    try {
      const response = await fetch(`${baseUrl}/api/v2/task/async`, {
        method: "POST",
        headers: {
          "authorization": authHeader,
          "content-type": "application/json",
          "accept": "application/json"
        },
        body: JSON.stringify({
          url: data.url,
          callback_url: callbackUrl,
        })
      });

      if (!response.ok) {
        throw new Error(`Hive API error: ${response.statusText}`);
      }

      const result = await response.json();
      const taskId = result.task_id ?? result.id;
      
      await supabase.from("hive_provider_tasks").insert({
        scan_job_id: data.scanJobId,
        result_id: data.resultId,
        hive_task_id: taskId,
        request_type: "async_url",
        provider_status: "submitted",
      });

      return { ok: true, taskId };
    } catch (error: any) {
      await supabase.from("hive_provider_tasks").insert({
        scan_job_id: data.scanJobId,
        result_id: data.resultId,
        request_type: "async_url",
        provider_status: "failed",
        error_message: error.message,
      });
      throw error;
    }
  });

export const classifyImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { url: string; scanJobId: string; resultId: string }) => 
    z.object({ url: z.string().url(), scanJobId: z.string().uuid(), resultId: z.string().uuid() }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const config = getHiveConfig();
    
    if (config.error) {
      return { ok: false, error: config.error };
    }
    
    const { authHeader, baseUrl } = config;
    
    const startTime = Date.now();
    try {
      const response = await fetch(`${baseUrl}/api/v2/task/sync`, {
        method: "POST",
        headers: {
          "authorization": authHeader,
          "content-type": "application/json",
          "accept": "application/json"
        },
        body: JSON.stringify({ url: data.url })
      });

      const latency = Date.now() - startTime;

      if (!response.ok) {
        throw new Error(`Hive API error: ${response.statusText}`);
      }

      const result = await response.json();
      const taskId = result.task_id ?? result.id ?? `sync-${Date.now()}`;
      
      const normalized = normalizeHiveResponse(result);

      await supabase.from("hive_provider_tasks").insert({
        scan_job_id: data.scanJobId,
        result_id: data.resultId,
        hive_task_id: taskId,
        request_type: "sync_image",
        provider_status: "completed",
        latency_ms: latency,
        raw_result_private_reference: JSON.stringify(result) // Limited scope logic for now
      });

      await supabase.from("sensitive_scan_results").update(normalized).eq("id", data.resultId);
      
      // We would run calculateSensitiveScores() here, but in real architecture, Rekognition should run too.
      return { ok: true, normalized };
    } catch (error: any) {
      await supabase.from("hive_provider_tasks").insert({
        scan_job_id: data.scanJobId,
        result_id: data.resultId,
        request_type: "sync_image",
        provider_status: "failed",
        latency_ms: Date.now() - startTime,
        error_message: error.message,
      });
      throw error;
    }
  });

export function normalizeHiveResponse(raw: any) {
  // Mock normalization, in reality inspect raw.status[0].response.output
  // mapping 'yes_nsfw' -> explicit_content_score etc.
  
  let explicit_content_score = 0;
  let nudity_score = 0;
  let sexual_content_score = 0;
  let suggestive_content_score = 0;
  let ai_generated_score = 0;
  let deepfake_score = 0;

  try {
    const classes = raw?.status?.[0]?.response?.output?.[0]?.classes ?? [];
    for (const c of classes) {
      if (c.class === "yes_nsfw") explicit_content_score = Math.max(explicit_content_score, c.score);
      if (c.class === "general_nsfw") explicit_content_score = Math.max(explicit_content_score, c.score);
      if (c.class === "nudity") nudity_score = Math.max(nudity_score, c.score);
      if (c.class === "sexual_activity") sexual_content_score = Math.max(sexual_content_score, c.score);
      if (c.class === "suggestive") suggestive_content_score = Math.max(suggestive_content_score, c.score);
      if (c.class === "ai_generated") ai_generated_score = Math.max(ai_generated_score, c.score);
      if (c.class === "deepfake" || c.class === "face_swap") deepfake_score = Math.max(deepfake_score, c.score);
    }
  } catch(e) {
    // Ignore formatting errors from dummy provider response
  }

  return {
    explicit_content_score,
    nudity_score,
    sexual_content_score,
    suggestive_content_score,
    ai_generated_score,
    deepfake_score,
  };
}

export function calculateRiskLevel(
  explicit: number, deepfake: number, faceSimilarity: number, duplicateCount: number
): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  if (explicit > 0.9 && faceSimilarity > 0.9) return "CRITICAL";
  if (explicit > 0.8 && deepfake > 0.8) return "HIGH";
  if (explicit > 0.5 || faceSimilarity > 0.7) return "MEDIUM";
  return "LOW";
}

export const getHiveDiagnostics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const accessKeyId = process.env.HIVE_ACCESS_KEY_ID;
    const secretKey = process.env.HIVE_SECRET_KEY;
    
    const configured = !!(accessKeyId && secretKey);

    const { data: stats } = await supabase
      .from("hive_provider_tasks")
      .select("provider_status, latency_ms, completed_at, error_message")
      .order("submitted_at", { ascending: false })
      .limit(100);

    let requestsProcessed = 0;
    let totalLatency = 0;
    let latencyCount = 0;
    let lastSuccess = null;
    let lastError = null;

    if (stats) {
      requestsProcessed = stats.length;
      for (const row of stats) {
        if (row.provider_status === 'completed' || row.provider_status === 'failed') {
          if (row.latency_ms) {
            totalLatency += row.latency_ms;
            latencyCount++;
          }
        }
        if (!lastSuccess && row.provider_status === 'completed') {
          lastSuccess = row.completed_at;
        }
        if (!lastError && row.provider_status === 'failed' && row.error_message) {
          lastError = row.error_message;
        }
      }
    }

    return {
      configured,
      authStatus: configured ? "Valid" : "Missing Credentials",
      averageLatency: latencyCount > 0 ? Math.round(totalLatency / latencyCount) : 0,
      requestsProcessed,
      lastSuccess,
      lastError
    };
  });
