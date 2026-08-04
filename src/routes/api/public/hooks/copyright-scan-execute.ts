import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";


const BodySchema = z.object({ scan_id: z.string().uuid() });

export const Route = createFileRoute("/api/public/hooks/copyright-scan-execute")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const requestId =
          typeof globalThis.crypto?.randomUUID === "function"
            ? globalThis.crypto.randomUUID()
            : `worker-hook-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const receivedAt = new Date().toISOString();
        console.info("copyright_scan_worker_hook_entry", {
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
          console.error("copyright_scan_worker_hook_body_read_failed", {
            request_id: requestId,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : null,
          });
          return new Response("Invalid body", { status: 400 });
        }

        const { verifyCopyrightScanWorkerRequestDetailed } = await import("@/lib/copyright/worker-auth.server");
        const verification = await verifyCopyrightScanWorkerRequestDetailed(
          raw,
          request.headers.get("x-eterna-timestamp"),
          request.headers.get("x-eterna-signature"),
        );
        console.info("copyright_scan_worker_hook_hmac_verification", {
          request_id: requestId,
          ok: verification.ok,
          reason: verification.reason,
          timestamp_age_ms: verification.timestamp_age_ms,
          worker_secret_present: verification.worker_secret_present,
          worker_secret_length: verification.worker_secret_length,
        });
        if (!verification.ok) return new Response("Invalid signature", { status: 401 });

        let parsed: z.infer<typeof BodySchema>;
        try {
          parsed = BodySchema.parse(JSON.parse(raw));
        } catch (error) {
          console.error("copyright_scan_worker_hook_body_invalid", {
            request_id: requestId,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : null,
          });
          return new Response(`Invalid body: ${error instanceof Error ? error.message : String(error)}`, {
            status: 400,
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { executeCopyrightScanById, recordCopyrightScanDiagnostic } = await import("@/lib/copyright.functions");
        await recordCopyrightScanDiagnostic(supabaseAdmin, parsed.scan_id, {
          worker_hook_request_id: requestId,
          worker_hook_received_at: receivedAt,
          worker_hook_hmac_verified_at: new Date().toISOString(),
          worker_hook_secret_present: verification.worker_secret_present,
          worker_hook_secret_length: verification.worker_secret_length,
        });
        console.info("copyright_scan_worker_execute_start", {
          request_id: requestId,
          scan_id: parsed.scan_id,
        });
        try {
          const result = await executeCopyrightScanById({
            supabase: supabaseAdmin,
            scanId: parsed.scan_id,
            source: "worker",
          });
          console.info("copyright_scan_worker_execute_complete", {
            request_id: requestId,
            scan_id: parsed.scan_id,
            status: result.status,
          });
          return Response.json(result);
        } catch (error) {
          console.error("copyright_scan_worker_execute_failed", {
            request_id: requestId,
            scan_id: parsed.scan_id,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : null,
          });
          await recordCopyrightScanDiagnostic(supabaseAdmin, parsed.scan_id, {
            worker_hook_executor_error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
            worker_hook_executor_failed_at: new Date().toISOString(),
          });
          return Response.json(
            { error: error instanceof Error ? error.message : String(error) },
            { status: 500 },
          );
        }
      },
    },
  },
});
