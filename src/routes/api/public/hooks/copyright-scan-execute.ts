import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const BodySchema = z.object({ scan_id: z.string().uuid() });

export const Route = createFileRoute("/api/public/hooks/copyright-scan-execute")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const { verifyCopyrightScanWorkerRequest } = await import("@/lib/copyright/worker-auth.server");
        const ok = verifyCopyrightScanWorkerRequest(
          raw,
          request.headers.get("x-eterna-timestamp"),
          request.headers.get("x-eterna-signature"),
        );
        if (!ok) return new Response("Invalid signature", { status: 401 });

        let parsed: z.infer<typeof BodySchema>;
        try {
          parsed = BodySchema.parse(JSON.parse(raw));
        } catch (error) {
          return new Response(`Invalid body: ${error instanceof Error ? error.message : String(error)}`, {
            status: 400,
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { executeCopyrightScanById } = await import("@/lib/copyright.functions");
        try {
          const result = await executeCopyrightScanById({
            supabase: supabaseAdmin,
            scanId: parsed.scan_id,
            source: "worker",
          });
          return Response.json(result);
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : String(error) },
            { status: 500 },
          );
        }
      },
    },
  },
});
