import { createFileRoute } from "@tanstack/react-router";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { runAcceptedBackgroundWork } from "@/lib/deepfake/startup-network.server";

const BodySchema = z.object({ scan_id: z.string().uuid() });

export const Route = createFileRoute(
  "/api/public/hooks/deepfake-google-images-worker",
)({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const requestId = randomUUID();

        let raw: string;
        try {
          raw = await request.text();
        } catch {
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

        console.info("deepfake_google_images_worker_accepted", {
          request_id: requestId,
          scan_id: parsed.scan_id,
        });

        const work = (async () => {
          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );
          const { executeGoogleImagesWorkerBatch } = await import(
            "@/lib/deepfake/google-images-worker.server"
          );
          try {
            const result = await executeGoogleImagesWorkerBatch({
              supabase: supabaseAdmin,
              scanId: parsed.scan_id,
            });
            console.info("deepfake_google_images_worker_complete", {
              request_id: requestId,
              scan_id: parsed.scan_id,
              processed: result.processed,
              remaining: result.remaining,
            });
          } catch (error) {
            console.error("deepfake_google_images_worker_failed", {
              request_id: requestId,
              scan_id: parsed.scan_id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        })();

        runAcceptedBackgroundWork(work);
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
