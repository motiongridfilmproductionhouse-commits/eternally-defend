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
  status: z
    .enum(["queued", "running", "review_ready", "submitted", "failed", "cancelled"])
    .optional(),
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
          return new Response(`Invalid body: ${e instanceof Error ? e.message : String(e)}`, {
            status: 400,
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { applyAutomationStatusCallback } =
          await import("@/lib/automation/status-callback.server");

        const result = await applyAutomationStatusCallback(supabaseAdmin, parsed);
        if (!result.ok) return new Response(result.message, { status: result.status });

        return Response.json({ ok: true });
      },
    },
  },
});
