/**
 * Enforcement Automation — server functions.
 *
 * Enqueue automation jobs against enforcement requests, expose job/event
 * status to the UI, save encrypted platform credentials, and let a human
 * operator mark a case submitted after they click Submit on the platform.
 *
 * All privileged writes go through the signed-in user's Supabase client so
 * RLS scopes rows to the caller. The external Playwright worker uses the
 * separate `/api/public/hooks/automation-*` HMAC-authenticated hooks.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const AdapterEnum = z.enum(["youtube_copyright", "youtube_community"]);
const PlatformEnum = z.enum(["youtube"]);

const EnqueueInput = z.object({
  enforcementRequestId: z.string().uuid(),
  adapter: AdapterEnum,
});

export const enqueueAutomationJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => EnqueueInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Load the enforcement request and verify ownership + readiness.
    const { data: req, error: reqErr } = await supabase
      .from("enforcement_requests")
      .select("id,user_id,platform,method,status,target_url,evidence_pdf_path,authorization_pdf_path,platform_complaint_pdf_path")
      .eq("id", data.enforcementRequestId)
      .maybeSingle();
    if (reqErr) throw reqErr;
    if (!req) throw new Error("Enforcement request not found");
    if (!req.evidence_pdf_path || !req.authorization_pdf_path) {
      throw new Error("Enforcement package not generated yet. Generate it before running automation.");
    }

    const platform = data.adapter.startsWith("youtube") ? "youtube" : null;
    if (!platform) throw new Error("Unsupported adapter");

    // Refuse duplicate active jobs.
    const { data: existing } = await supabase
      .from("automation_jobs")
      .select("id,status")
      .eq("enforcement_request_id", data.enforcementRequestId)
      .in("status", ["queued", "running", "review_ready"])
      .maybeSingle();
    if (existing) {
      return { jobId: existing.id, alreadyRunning: true as const };
    }

    const inputJson = {
      enforcement_request_id: req.id,
      target_url: req.target_url,
      evidence_pdf_path: req.evidence_pdf_path,
      authorization_pdf_path: req.authorization_pdf_path,
      platform_complaint_pdf_path: req.platform_complaint_pdf_path,
      method: req.method,
    };

    const { data: job, error: jobErr } = await supabase
      .from("automation_jobs")
      .insert({
        user_id: userId,
        enforcement_request_id: req.id,
        platform,
        adapter: data.adapter,
        status: "queued",
        input_json: inputJson,
      })
      .select("id")
      .single();
    if (jobErr || !job) throw jobErr ?? new Error("Failed to enqueue job");

    await supabase.from("automation_events").insert({
      user_id: userId,
      job_id: job.id,
      event: "job_enqueued",
      platform,
      result: "ok",
      payload_json: { adapter: data.adapter },
    });

    await supabase
      .from("enforcement_requests")
      .update({ automation_job_id: job.id, automation_status: "queued" })
      .eq("id", req.id);

    // Fire-and-forget notify to the worker service, if configured.
    const workerUrl = process.env.AUTOMATION_WORKER_URL;
    if (workerUrl) {
      const { signAutomationRequest } = await import("./hmac.server");
      const body = JSON.stringify({ job_id: job.id });
      const { signature, timestamp } = signAutomationRequest(body);
      try {
        await fetch(`${workerUrl.replace(/\/$/, "")}/run`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-eterna-timestamp": timestamp,
            "x-eterna-signature": signature,
          },
          body,
        });
      } catch (e) {
        // Don't fail the enqueue if the worker is temporarily unreachable;
        // the worker can also long-poll queued jobs.
        console.warn("[automation] worker notify failed", e);
      }
    }

    return { jobId: job.id, alreadyRunning: false as const };
  });

export const listAutomationJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("automation_jobs")
      .select("id,enforcement_request_id,platform,adapter,status,attempts,started_at,completed_at,created_at,review_summary_json,error_json,last_screenshot_path,cdp_ws_url,cdp_expires_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return { jobs: data ?? [] };
  });

export const getAutomationJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const [{ data: job, error: jobErr }, { data: events, error: eventsErr }] = await Promise.all([
      supabase.from("automation_jobs").select("*").eq("id", data.jobId).maybeSingle(),
      supabase
        .from("automation_events")
        .select("id,event,result,duration_ms,payload_json,screenshot_path,created_at")
        .eq("job_id", data.jobId)
        .order("created_at", { ascending: true })
        .limit(500),
    ]);
    if (jobErr) throw jobErr;
    if (eventsErr) throw eventsErr;
    if (!job) throw new Error("Job not found");
    return { job, events: events ?? [] };
  });

export const cancelAutomationJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("automation_jobs")
      .update({ status: "cancelled", completed_at: new Date().toISOString() })
      .eq("id", data.jobId)
      .in("status", ["queued", "running", "review_ready"]);
    if (error) throw error;
    await supabase.from("automation_events").insert({
      user_id: userId,
      job_id: data.jobId,
      event: "cancelled",
      result: "ok",
      payload_json: {},
    });
    return { ok: true };
  });

export const markHumanSubmitted = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid(), notes: z.string().max(2000).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const nowIso = new Date().toISOString();
    const { data: job, error: jobErr } = await supabase
      .from("automation_jobs")
      .update({ status: "submitted", completed_at: nowIso })
      .eq("id", data.jobId)
      .select("id,enforcement_request_id")
      .single();
    if (jobErr || !job) throw jobErr ?? new Error("Job not found");

    await supabase
      .from("enforcement_requests")
      .update({
        automation_status: "submitted",
        human_submitted_at: nowIso,
        human_submitted_by: userId,
        status: "Sent",
        submitted_at: nowIso,
      })
      .eq("id", job.enforcement_request_id);

    await supabase.from("automation_events").insert({
      user_id: userId,
      job_id: job.id,
      event: "submission_completed",
      result: "ok",
      payload_json: { source: "operator", notes: data.notes ?? null },
    });

    return { ok: true };
  });

export const saveCredentialVault = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        platform: PlatformEnum,
        label: z.string().max(100).optional(),
        storageStateJson: z.string().min(2).max(1_000_000),
        loginEmail: z.string().email().optional(),
        mfaHint: z.string().max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { encryptVault } = await import("./vault.server");
    const storage_state_ciphertext = encryptVault(data.storageStateJson);
    const login_email_ciphertext = data.loginEmail ? encryptVault(data.loginEmail) : null;
    const { error } = await supabase.from("platform_credentials").upsert(
      {
        user_id: userId,
        platform: data.platform,
        label: data.label ?? "primary",
        storage_state_ciphertext,
        login_email_ciphertext,
        mfa_hint: data.mfaHint ?? null,
        status: "active",
        last_verified_at: new Date().toISOString(),
      },
      { onConflict: "user_id,platform,label" },
    );
    if (error) throw error;
    return { ok: true };
  });

export const listCredentialVault = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("platform_credentials")
      .select("id,platform,label,status,mfa_hint,last_verified_at,created_at,updated_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return { credentials: data ?? [] };
  });
