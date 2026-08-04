import { createFileRoute } from "@tanstack/react-router";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  isVercelWaitUntilRuntime,
  registerWaitUntilExecution,
} from "@/lib/deepfake/startup-network.server";
import { persistDeepfakeWorkerEvent } from "@/lib/deepfake/worker-events.server";

const BodySchema = z.object({
  scan_id: z.string().uuid(),
  worker_execution_id: z.string().min(8).max(80).optional(),
  startup_correlation_id: z.string().min(8).max(80).optional(),
});

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
          wait_until_runtime: isVercelWaitUntilRuntime(),
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

        const workerExecutionId =
          parsed.worker_execution_id?.trim() || randomUUID();
        const startupCorrelationId =
          parsed.startup_correlation_id?.trim() || null;

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        await persistDeepfakeWorkerEvent({
          supabase: supabaseAdmin,
          scanId: parsed.scan_id,
          workerExecutionId,
          requestId,
          eventName: "worker_hook_received",
          metadata: {
            startup_correlation_id: startupCorrelationId,
            received_at: receivedAt,
          },
        });
        await persistDeepfakeWorkerEvent({
          supabase: supabaseAdmin,
          scanId: parsed.scan_id,
          workerExecutionId,
          requestId,
          eventName: "worker_signature_validated",
          metadata: { reason: verification.reason },
        });
        await persistDeepfakeWorkerEvent({
          supabase: supabaseAdmin,
          scanId: parsed.scan_id,
          workerExecutionId,
          requestId,
          eventName: "worker_payload_validated",
          metadata: {
            scan_id: parsed.scan_id,
            worker_execution_id: workerExecutionId,
            startup_correlation_id: startupCorrelationId,
          },
        });

        // Direct waitUntil pattern — create the promise, register it, then 202.
        // Do NOT wrap in setImmediate/setTimeout.
        const { executeDeepfakeScanById } = await import(
          "@/lib/deepfake-intel.functions"
        );
        const executionPromise = executeDeepfakeScanById({
          supabase: supabaseAdmin,
          scanId: parsed.scan_id,
          source: "worker",
          workerExecutionId,
          requestId,
          startupCorrelationId,
        }).catch(async (error) => {
          await persistDeepfakeWorkerEvent({
            supabase: supabaseAdmin,
            scanId: parsed.scan_id,
            workerExecutionId,
            requestId,
            eventName: "worker_execution_failed",
            errorCategory: "worker_execution_failed",
            errorMessage:
              error instanceof Error ? error.message : String(error),
            metadata: {
              stack: error instanceof Error ? error.stack : null,
            },
          });
        });

        const scheduled = registerWaitUntilExecution(executionPromise);
        await persistDeepfakeWorkerEvent({
          supabase: supabaseAdmin,
          scanId: parsed.scan_id,
          workerExecutionId,
          requestId,
          eventName: "wait_until_registered",
          metadata: {
            wait_until_used: scheduled.wait_until_used,
            vercel_runtime: isVercelWaitUntilRuntime(),
          },
        });

        return Response.json(
          {
            accepted: true,
            scan_id: parsed.scan_id,
            worker_execution_id: workerExecutionId,
            request_id: requestId,
            wait_until_used: scheduled.wait_until_used,
          },
          { status: 202 },
        );
      },
    },
  },
});
