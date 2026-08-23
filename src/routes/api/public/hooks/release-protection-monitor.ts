import { createFileRoute } from "@tanstack/react-router";
import {
  authorizeCronRequest,
  cronAuthResponse,
  requireTrustedRuntime,
} from "@/lib/protection/cron-auth.server";

export const Route = createFileRoute("/api/public/hooks/release-protection-monitor")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const runtime = requireTrustedRuntime();
        if (!runtime.ok) return runtime.response;

        const auth = await authorizeCronRequest(request, {
          jobName: "release_protection_monitor",
          envSecrets: [
            process.env.RELEASE_PROTECTION_MONITOR_SECRET,
            process.env.DISTRIBUTION_MONITOR_SECRET,
            process.env.CHANNEL_WATCH_POLL_SECRET,
          ],
        });
        if (!auth.ok) return cronAuthResponse(auth);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runReleaseProtectionSweep } =
          await import("@/lib/copyright/release-protection.server");

        const result = await runReleaseProtectionSweep(supabaseAdmin, { limit: 15 });
        return Response.json({
          ok: true,
          ...result,
        });
      },
    },
  },
});
