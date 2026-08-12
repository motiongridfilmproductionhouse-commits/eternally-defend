/**
 * GET /api/scan/:scanRunId/status
 *
 * Returns a small, real-only progress snapshot for a Web Scan run — never
 * the report/hits. Read-only; safe to poll frequently. Payload shape:
 * { status, stage, counters, providers, error }.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/scan/$scanRunId/status")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const scanRunId = params.scanRunId;
        if (!scanRunId) {
          return Response.json({ ok: false, error: "scanRunId required" }, { status: 400 });
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await supabaseAdmin
            .from("web_scan_progress")
            .select(
              "status, stage, counters, providers, error, started_at, updated_at, finished_at",
            )
            .eq("id", scanRunId)
            .maybeSingle();

          if (error) {
            return Response.json(
              { ok: false, error: "Unable to read scan progress" },
              { status: 500 },
            );
          }
          if (!data) {
            return Response.json({ ok: false, error: "Scan run not found" }, { status: 404 });
          }

          return Response.json({
            ok: true,
            status: data.status,
            stage: data.stage,
            counters: data.counters ?? {},
            providers: data.providers ?? [],
            error: data.error ?? null,
            startedAt: data.started_at,
            updatedAt: data.updated_at,
            finishedAt: data.finished_at,
          });
        } catch (e) {
          console.error("[scan.$scanRunId.status] failed", e);
          return Response.json(
            { ok: false, error: "Unable to read scan progress" },
            { status: 500 },
          );
        }
      },
    },
  },
});
