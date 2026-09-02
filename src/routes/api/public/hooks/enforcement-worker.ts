import { createFileRoute } from "@tanstack/react-router";
import {
  authorizeCronRequest,
  cronAuthResponse,
  requireTrustedRuntime,
} from "@/lib/protection/cron-auth.server";

export const Route = createFileRoute("/api/public/hooks/enforcement-worker")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        // Privileged job: requires the managed backend admin credential.
        const runtime = requireTrustedRuntime();
        if (!runtime.ok) return runtime.response;

        // FAIL CLOSED: with neither an env worker secret nor a managed
        // scheduler token configured, this returns 503 — never "authenticated".
        const auth = await authorizeCronRequest(request, {
          jobName: "enforcement_worker",
          envSecrets: [process.env.ENFORCEMENT_WORKER_SECRET],
        });
        if (!auth.ok) return cronAuthResponse(auth);

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { EnforcementWorkerRunner } = await import("@/lib/enforcement/worker");
          const { AutoEnforcementOrchestrator } = await import("@/lib/enforcement/orchestrator");

          // Self-heal QUEUED cases whose dispatch job was never created. All
          // send-time gates are still evaluated by the worker below.
          const repaired = await AutoEnforcementOrchestrator.requeueMissingJobs(
            supabaseAdmin as never,
          );

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
              repairedQueueJobs: repaired,
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
