/**
 * Scheduled poll worker endpoint — the database scheduler hits this every few
 * minutes. Iterates channel_watches whose next_check_at has elapsed and runs
 * pollOneWatch for each. Auth: env worker secret or the managed scheduler
 * token in internal_cron_secrets (never PII exposure).
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  authorizeCronRequest,
  cronAuthResponse,
  requireTrustedRuntime,
} from "@/lib/protection/cron-auth.server";

export const Route = createFileRoute("/api/public/hooks/channel-watch-poll")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const runtime = requireTrustedRuntime();
        if (!runtime.ok) return runtime.response;

        const auth = await authorizeCronRequest(request, {
          jobName: "channel_watch_poll",
          envSecrets: [process.env.CHANNEL_WATCH_POLL_SECRET],
        });
        if (!auth.ok) return cronAuthResponse(auth);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { pollOneWatch } = await import("@/lib/channel-watch/poll.server");
        const nowIso = new Date().toISOString();
        const { data: due } = await supabaseAdmin
          .from("channel_watches")
          .select("id")
          .eq("status", "active")
          .or(`next_check_at.is.null,next_check_at.lte.${nowIso}`)
          .limit(25);
        const results: Array<{ id: string; ok: boolean; error?: string }> = [];
        for (const w of due ?? []) {
          try {
            await pollOneWatch(supabaseAdmin, w.id);
            results.push({ id: w.id, ok: true });
          } catch (err) {
            results.push({ id: w.id, ok: false, error: (err as Error).message });
          }
        }
        return Response.json({ processed: results.length, results });
      },
    },
  },
});
