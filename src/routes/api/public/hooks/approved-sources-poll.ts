/**
 * Scheduled poll worker endpoint for Approved YouTube Sources — the database
 * scheduler hits this periodically. Iterates approved_youtube_sources of
 * kind 'channel' whose next_poll_at has elapsed and runs
 * pollApprovedChannelSource for each. Auth: env worker secret or the managed
 * scheduler token in internal_cron_secrets, same as channel-watch-poll.
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  authorizeCronRequest,
  cronAuthResponse,
  requireTrustedRuntime,
} from "@/lib/protection/cron-auth.server";

export const Route = createFileRoute("/api/public/hooks/approved-sources-poll")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const runtime = requireTrustedRuntime();
        if (!runtime.ok) return runtime.response;

        const auth = await authorizeCronRequest(request, {
          jobName: "approved_sources_poll",
          envSecrets: [process.env.APPROVED_SOURCES_POLL_SECRET],
        });
        if (!auth.ok) return cronAuthResponse(auth);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { pollApprovedChannelSource } =
          await import("@/lib/protection/sources/poll-approved-source.server");
        const nowIso = new Date().toISOString();
        const { data: due } = await supabaseAdmin
          .from("approved_youtube_sources")
          .select("id")
          .eq("source_kind", "channel")
          .eq("status", "active")
          .or(`next_poll_at.is.null,next_poll_at.lte.${nowIso}`)
          .limit(25);
        const results: Array<{ id: string; ok: boolean; error?: string }> = [];
        for (const s of due ?? []) {
          try {
            await pollApprovedChannelSource(supabaseAdmin, s.id);
            results.push({ id: s.id, ok: true });
          } catch (err) {
            results.push({ id: s.id, ok: false, error: (err as Error).message });
          }
        }
        return Response.json({ processed: results.length, results });
      },
    },
  },
});
