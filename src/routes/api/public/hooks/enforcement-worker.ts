import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { EnforcementWorkerRunner } from "@/lib/enforcement/worker";

export const Route = createFileRoute("/api/public/hooks/enforcement-worker")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const authHeader = request.headers.get("authorization") || request.headers.get("x-eterna-cron-secret");
        const cronSecret = process.env.CRON_SECRET || process.env.ENFORCEMENT_WORKER_SECRET || process.env.COPYRIGHT_SCAN_WORKER_SECRET;

        // Verify Vercel Cron Bearer token or custom worker secret
        const expectedBearer = cronSecret ? `Bearer ${cronSecret}` : null;
        const isAuthValid = !cronSecret || authHeader === expectedBearer || authHeader === cronSecret;

        if (!isAuthValid) {
          return new Response(JSON.stringify({ error: "Unauthorized cron/worker invocation" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }

        try {
          let totalProcessed = 0;
          let hasMore = true;

          while (hasMore && totalProcessed < 10) {
            const processed = await EnforcementWorkerRunner.processNextJob(supabaseAdmin, "vercel-cron-scheduled-worker");
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
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
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
