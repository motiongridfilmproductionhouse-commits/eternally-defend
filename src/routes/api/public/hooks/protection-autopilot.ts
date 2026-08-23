import { createFileRoute } from "@tanstack/react-router";
import {
  authorizeCronRequest,
  cronAuthResponse,
  requireTrustedRuntime,
} from "@/lib/protection/cron-auth.server";

/**
 * Scheduled sweep for continuous protection. Called by the database scheduler
 * with the managed token (or an env worker secret); runs every due protection
 * target for every ACTIVE protection profile. Never sends external notices.
 */
export const Route = createFileRoute("/api/public/hooks/protection-autopilot")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const runtime = requireTrustedRuntime();
        if (!runtime.ok) return runtime.response;

        const auth = await authorizeCronRequest(request, {
          jobName: "protection_autopilot",
          envSecrets: [
            process.env.PROTECTION_AUTOPILOT_SECRET,
            process.env.RELEASE_PROTECTION_MONITOR_SECRET,
            process.env.CHANNEL_WATCH_POLL_SECRET,
          ],
        });
        if (!auth.ok) return cronAuthResponse(auth);

        let limit = 5;
        try {
          const body = (await request.json()) as { limit?: number };
          if (typeof body?.limit === "number") limit = Math.min(Math.max(body.limit, 1), 25);
        } catch {
          // empty body is fine
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runProtectionSweep } = await import("@/lib/protection/autopilot.server");
        const { enforcementSwitches } = await import("@/lib/protection/autopilot");

        const result = await runProtectionSweep(supabaseAdmin, { limit });
        return Response.json({ ok: true, switches: enforcementSwitches(), ...result });
      },
    },
  },
});
