import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { recoverStaleBusinessScans } from "@/lib/business-reputation/continuation.server";
import { dispatchBusinessReputationScan } from "@/lib/business-reputation/scan-worker-dispatch.server";

const Body = z.object({ sweep: z.literal(true).optional() }).default({ sweep: true });

export const Route = createFileRoute("/api/public/hooks/business-reputation-scan-recover")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const { verifyCopyrightScanWorkerRequestDetailed } =
          await import("@/lib/copyright/worker-auth.server");
        const verification = await verifyCopyrightScanWorkerRequestDetailed(
          raw,
          request.headers.get("x-eterna-timestamp"),
          request.headers.get("x-eterna-signature"),
        );
        if (!verification.ok) return new Response("Invalid signature", { status: 401 });
        try {
          Body.parse(JSON.parse(raw));
        } catch {
          return new Response("Invalid recovery payload", { status: 400 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const results = await recoverStaleBusinessScans({
          supabase: supabaseAdmin,
          dispatch: ({ scanId, scanRunToken, startupCorrelationId }) =>
            dispatchBusinessReputationScan({ scanId, scanRunToken, startupCorrelationId }),
        });
        return Response.json(
          { accepted: true, recovered: results.filter((x) => x.recovered).length },
          { status: 202 },
        );
      },
    },
  },
});
