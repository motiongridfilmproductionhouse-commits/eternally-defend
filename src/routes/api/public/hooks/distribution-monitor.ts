/**
 * Scheduled Auto Monitor worker — re-crawls registered unauthorized
 * distribution sources whose next_check_at has elapsed, using the existing
 * crawler pipeline. Auth: shared bearer secret.
 */
import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

export const Route = createFileRoute("/api/public/hooks/distribution-monitor")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.DISTRIBUTION_MONITOR_SECRET ?? process.env.CHANNEL_WATCH_POLL_SECRET;
        if (!secret) return new Response("Not configured", { status: 500 });
        const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
        const a = Buffer.from(token);
        const b = Buffer.from(secret);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runAutoMonitor } = await import("@/lib/copyright/distribution-monitor.server");
        const result = await runAutoMonitor(supabaseAdmin, { limit: 20, runType: "auto_monitor" });
        return Response.json(result);
      },
    },
  },
});
