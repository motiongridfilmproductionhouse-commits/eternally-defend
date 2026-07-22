/**
 * Scheduled poll worker endpoint — pg_cron hits this every few minutes.
 * Iterates channel_watches whose next_check_at has elapsed and runs
 * pollOneWatch for each. Auth: shared bearer secret (never PII exposure).
 */
import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

export const Route = createFileRoute("/api/public/hooks/channel-watch-poll")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.CHANNEL_WATCH_POLL_SECRET;
        if (!secret) return new Response("Not configured", { status: 500 });
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.replace(/^Bearer\s+/i, "");
        const a = Buffer.from(token);
        const b = Buffer.from(secret);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return new Response("Unauthorized", { status: 401 });
        }
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
