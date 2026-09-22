/**
 * Read-only status check the external enforcement-worker service polls
 * mid-job to detect cancellation. The worker has no direct DB access — it
 * only talks to the main app over HMAC-signed HTTP — so this is how
 * `runJob` (services/enforcement-worker/src/runner.ts) learns that a job was
 * cancelled while it was still running a Playwright step.
 *
 * HMAC-signed by the worker with AUTOMATION_WORKER_SECRET, same as the other
 * `automation-*` hooks. Body: `{ job_id }`. Returns only the current status —
 * never job input, credentials, or evidence.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const BodySchema = z.object({ job_id: z.string().uuid() });

export const Route = createFileRoute("/api/public/hooks/automation-status-check")({
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

        let parsed: z.infer<typeof BodySchema>;
        try {
          parsed = BodySchema.parse(JSON.parse(raw));
        } catch (e) {
          return new Response(`Invalid body: ${e instanceof Error ? e.message : String(e)}`, {
            status: 400,
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: job, error } = await supabaseAdmin
          .from("automation_jobs")
          .select("id,status")
          .eq("id", parsed.job_id)
          .maybeSingle();
        if (error) return new Response(error.message, { status: 500 });
        if (!job) return new Response("Job not found", { status: 404 });

        return Response.json({ job_id: job.id, status: job.status });
      },
    },
  },
});
