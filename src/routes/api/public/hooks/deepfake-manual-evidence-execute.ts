import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const BodySchema = z.object({
  lead_ids: z.array(z.string().uuid()).min(1).max(50),
});

export const Route = createFileRoute("/api/public/hooks/deepfake-manual-evidence-execute")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const requestId =
          typeof globalThis.crypto?.randomUUID === "function"
            ? globalThis.crypto.randomUUID()
            : `manual-evidence-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        console.info("deepfake_manual_evidence_worker_hook_entry", {
          request_id: requestId,
          timestamp_present: Boolean(request.headers.get("x-eterna-timestamp")),
          signature_present: Boolean(request.headers.get("x-eterna-signature")),
        });

        let raw: string;
        try {
          raw = await request.text();
        } catch (error) {
          console.error("deepfake_manual_evidence_worker_body_read_failed", {
            request_id: requestId,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : null,
          });
          return new Response("Invalid body", { status: 400 });
        }

        const { verifyManualEvidenceWorkerRequest } = await import(
          "@/lib/deepfake/manual-evidence.server"
        );
        const verification = await verifyManualEvidenceWorkerRequest(
          raw,
          request.headers.get("x-eterna-timestamp"),
          request.headers.get("x-eterna-signature"),
        );
        console.info("deepfake_manual_evidence_worker_hmac_verification", {
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
          console.error("deepfake_manual_evidence_worker_body_invalid", {
            request_id: requestId,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : null,
          });
          return new Response(
            `Invalid body: ${error instanceof Error ? error.message : String(error)}`,
            { status: 400 },
          );
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { processManualEvidenceLeadsById } = await import(
          "@/lib/deepfake/manual-evidence.server"
        );

        console.info("deepfake_manual_evidence_worker_execute_start", {
          request_id: requestId,
          lead_count: parsed.lead_ids.length,
        });
        try {
          const result = await processManualEvidenceLeadsById({
            supabase: supabaseAdmin,
            leadIds: parsed.lead_ids,
          });
          console.info("deepfake_manual_evidence_worker_execute_complete", {
            request_id: requestId,
            ...result,
          });
          return Response.json(result);
        } catch (error) {
          console.error("deepfake_manual_evidence_worker_execute_failed", {
            request_id: requestId,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : null,
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
