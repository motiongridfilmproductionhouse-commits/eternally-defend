/**
 * POST /api/scan/start
 *
 * Creates a Web Scan progress row and returns its id (scanRunId) immediately.
 * Does NOT run the scan itself — the client still calls POST /api/scan (now
 * carrying this scanRunId) to actually execute the pipeline, and polls
 * GET /api/scan/:scanRunId/status in parallel to drive the live-status UI
 * with real checkpoints written by that same request.
 *
 * No auth check here, matching /api/scan's existing unauthenticated-at-the-
 * route posture (no createServerFn middleware applies to file routes, and
 * /api/scan itself never parses a session) — this is not a new behavior.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/scan/start")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json().catch(() => ({}));
          const query = String((body as { query?: unknown })?.query ?? "")
            .trim()
            .slice(0, 200);
          if (!query) {
            return Response.json({ ok: false, error: "Query required" }, { status: 400 });
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await supabaseAdmin
            .from("web_scan_progress")
            .insert({
              query,
              status: "queued",
              stage: "INITIALIZING",
            })
            .select("id")
            .single();

          if (error || !data) {
            return Response.json(
              { ok: false, error: "Unable to start scan progress tracking" },
              { status: 500 },
            );
          }

          return Response.json({ ok: true, scanRunId: data.id });
        } catch (e) {
          console.error("[scan.start] failed", e);
          return Response.json({ ok: false, error: "Unable to start scan" }, { status: 500 });
        }
      },
    },
  },
});
