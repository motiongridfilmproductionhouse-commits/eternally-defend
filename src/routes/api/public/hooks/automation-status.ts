/**
 * Callback endpoint the external enforcement-worker service uses to report
 * job status updates, audit events, and (optionally) screenshot paths.
 *
 * HMAC-signed by the worker with AUTOMATION_WORKER_SECRET; body layout is
 * `{ job_id, event, status?, result?, duration_ms?, payload?, screenshot_path?,
 *   review_summary?, cdp_ws_url?, cdp_expires_at?, error? }`.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const EventSchema = z.object({
  job_id: z.string().uuid(),
  event: z.string().min(1).max(64),
  status: z.enum(["queued", "running", "review_ready", "submitted", "failed", "cancelled"]).optional(),
  result: z.string().max(32).optional(),
  duration_ms: z.number().int().nonnegative().optional(),
  payload: z.record(z.unknown()).optional(),
  screenshot_path: z.string().max(500).optional(),
  review_summary: z.record(z.unknown()).optional(),
  review_bundle_path: z.string().max(500).optional(),
  cdp_ws_url: z.string().max(1000).optional(),
  cdp_expires_at: z.string().datetime().optional(),
  error: z.record(z.unknown()).optional(),
  worker_id: z.string().max(200).optional(),
});

export const Route = createFileRoute("/api/public/hooks/automation-status")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const { verifyAutomationRequest } = await import("@/lib/automation/hmac.server");
        const ok = verifyAutomationRequest(
          raw,
          request.headers.get("x-eterna-timestamp"),
          request.headers.get("x-eterna-signature"),
        );
        if (!ok) return new Response("Invalid signature", { status: 401 });

        let parsed: z.infer<typeof EventSchema>;
        try {
          parsed = EventSchema.parse(JSON.parse(raw));
        } catch (e) {
          return new Response(`Invalid body: ${e instanceof Error ? e.message : String(e)}`, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: job, error: jobErr } = await supabaseAdmin
          .from("automation_jobs")
          .select("id,user_id,platform,enforcement_request_id")
          .eq("id", parsed.job_id)
          .maybeSingle();
        if (jobErr) return new Response(jobErr.message, { status: 500 });
        if (!job) return new Response("Job not found", { status: 404 });

        // Update job row when relevant fields are present.
        const patch: Record<string, unknown> = {};
        if (parsed.status) patch.status = parsed.status;
        if (parsed.status === "running" && parsed.event === "browser_started") patch.started_at = new Date().toISOString();
        if (parsed.status === "review_ready" || parsed.status === "submitted" || parsed.status === "failed" || parsed.status === "cancelled") {
          patch.completed_at = new Date().toISOString();
        }
        if (parsed.review_summary) patch.review_summary_json = parsed.review_summary;
        if (parsed.review_bundle_path) patch.review_bundle_path = parsed.review_bundle_path;
        if (parsed.cdp_ws_url) patch.cdp_ws_url = parsed.cdp_ws_url;
        if (parsed.cdp_expires_at) patch.cdp_expires_at = parsed.cdp_expires_at;
        if (parsed.error) patch.error_json = parsed.error;
        if (parsed.screenshot_path) patch.last_screenshot_path = parsed.screenshot_path;
        if (parsed.worker_id) patch.worker_id = parsed.worker_id;

        if (Object.keys(patch).length > 0) {
          await supabaseAdmin.from("automation_jobs").update(patch).eq("id", job.id);
          if (parsed.status) {
            await supabaseAdmin
              .from("enforcement_requests")
              .update({ automation_status: parsed.status })
              .eq("id", job.enforcement_request_id);
          }
        }

        await supabaseAdmin.from("automation_events").insert({
          user_id: job.user_id,
          job_id: job.id,
          event: parsed.event,
          platform: job.platform,
          duration_ms: parsed.duration_ms ?? null,
          result: parsed.result ?? null,
          payload_json: parsed.payload ?? {},
          screenshot_path: parsed.screenshot_path ?? null,
        });

        return Response.json({ ok: true });
      },
    },
  },
});
