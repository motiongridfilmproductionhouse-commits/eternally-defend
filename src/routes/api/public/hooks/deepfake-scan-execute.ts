import { createFileRoute } from "@tanstack/react-router";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { runAcceptedBackgroundWork } from "@/lib/deepfake/startup-network.server";

const BodySchema = z.object({ scan_id: z.string().uuid() });

export const Route = createFileRoute("/api/public/hooks/deepfake-scan-execute")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const requestId = randomUUID();
        const receivedAt = new Date().toISOString();
        console.info("deepfake_scan_worker_hook_entry", {
          request_id: requestId,
          received_at: receivedAt,
          method: request.method,
          content_length: request.headers.get("content-length"),
          timestamp_present: Boolean(request.headers.get("x-eterna-timestamp")),
          signature_present: Boolean(request.headers.get("x-eterna-signature")),
        });

        let raw: string;
        try {
          raw = await request.text();
        } catch (error) {
          console.error("deepfake_scan_worker_hook_body_read_failed", {
            request_id: requestId,
            error: error instanceof Error ? error.message : String(error),
          });
          return new Response("Invalid body", { status: 400 });
        }

        const { verifyCopyrightScanWorkerRequestDetailed } = await import(
          "@/lib/copyright/worker-auth.server"
        );
        const verification = verifyCopyrightScanWorkerRequestDetailed(
          raw,
          request.headers.get("x-eterna-timestamp"),
          request.headers.get("x-eterna-signature"),
        );
        console.info("deepfake_scan_worker_hook_hmac_verification", {
          request_id: requestId,
          ok: verification.ok,
          reason: verification.reason,
        });
        if (!verification.ok) {
          return new Response("Invalid signature", { status: 401 });
        }

        let parsed: z.infer<typeof BodySchema>;
        try {
          parsed = BodySchema.parse(JSON.parse(raw));
        } catch (error) {
          return new Response(
            `Invalid body: ${error instanceof Error ? error.message : String(error)}`,
            { status: 400 },
          );
        }

        console.info("deepfake_scan_worker_execute_start", {
          request_id: requestId,
          scan_id: parsed.scan_id,
        });

        // Acknowledge immediately so scan-start / dispatch never waits on a
        // full worker batch (that previously surfaced as TypeError: fetch failed).
        const work = (async () => {
          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );
          const { executeDeepfakeScanById } = await import(
            "@/lib/deepfake-intel.functions"
          );
          try {
            const result = await executeDeepfakeScanById({
              supabase: supabaseAdmin,
              scanId: parsed.scan_id,
              source: "worker",
            });
            console.info("deepfake_scan_worker_execute_complete", {
              request_id: requestId,
              scan_id: parsed.scan_id,
              status: result.status,
              dispatched_next: result.dispatched_next,
            });
          } catch (error) {
            console.error("deepfake_scan_worker_execute_failed", {
              request_id: requestId,
              scan_id: parsed.scan_id,
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : null,
            });
          }
        })();

        runAcceptedBackgroundWork(work);
        // Brief yield so the worker task starts before the response flushes.
        await new Promise((resolve) => setTimeout(resolve, 25));

        return Response.json(
          {
            accepted: true,
            scan_id: parsed.scan_id,
            request_id: requestId,
          },
          { status: 202 },
        );
      },
    },
  },
});
