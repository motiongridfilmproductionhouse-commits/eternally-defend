/**
 * Scheduled Auto Monitor worker — re-crawls registered unauthorized
 * distribution sources whose next_check_at has elapsed, using the existing
 * crawler pipeline. Auth: env worker secret or managed scheduler token.
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  authorizeCronRequest,
  cronAuthResponse,
  requireTrustedRuntime,
} from "@/lib/protection/cron-auth.server";

export const Route = createFileRoute("/api/public/hooks/distribution-monitor")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const runtime = requireTrustedRuntime();
        if (!runtime.ok) return runtime.response;

        const auth = await authorizeCronRequest(request, {
          jobName: "distribution_monitor",
          envSecrets: [
            process.env.DISTRIBUTION_MONITOR_SECRET,
            process.env.CHANNEL_WATCH_POLL_SECRET,
          ],
        });
        if (!auth.ok) return cronAuthResponse(auth);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runAutoMonitor } = await import("@/lib/copyright/distribution-monitor.server");
        const result = await runAutoMonitor(supabaseAdmin, { limit: 20, runType: "auto_monitor" });
        return Response.json(result);
      },
    },
  },
});
