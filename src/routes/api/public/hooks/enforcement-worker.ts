import { createFileRoute } from "@tanstack/react-router";
import { verifyEnforcementWorkerRequest } from "@/lib/enforcement/worker-auth.server";

export const Route = createFileRoute("/api/public/hooks/enforcement-worker")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        // FAIL CLOSED: a missing/short worker secret is never "authenticated".
        const auth = verifyEnforcementWorkerRequest(request);
        if (!auth.ok) {
          return new Response(JSON.stringify({ error: auth.code, message: auth.message }), {
            status: auth.status,
            headers: { "content-type": "application/json" },
          });
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { EnforcementWorkerRunner } = await import("@/lib/enforcement/worker");

          let totalProcessed = 0;
          let hasMore = true;

          while (hasMore && totalProcessed < 10) {
            const processed = await EnforcementWorkerRunner.processNextJob(
              supabaseAdmin as never,
              "scheduled-enforcement-worker",
            );
            if (processed) {
              totalProcessed++;
            } else {
              hasMore = false;
            }
          }

          return new Response(
            JSON.stringify({
              ok: true,
              processedCount: totalProcessed,
              timestamp: new Date().toISOString(),
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return new Response(JSON.stringify({ error: msg }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
      },
    },
  },
});
