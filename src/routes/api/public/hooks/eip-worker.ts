/**
 * EIP worker hook. Called by the per-minute schedule that is armed only while
 * EIP work is pending (and disarmed by the worker when drained / engine off).
 * Auth: managed `eip_worker` token (internal_cron_secrets), verified in the DB.
 * Runs one bounded tick; the engine does the heavy work asynchronously.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/eip-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
        const { verifyEipWorkerToken, readWorkerConfig, httpEngine, dbPort } =
          await import("@/lib/eip/worker.server");
        if (!token || !(await verifyEipWorkerToken(token))) {
          return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        }
        const { runEipTick } = await import("@/lib/eip/worker-core");
        const cfg = readWorkerConfig();
        const engine = httpEngine(cfg.baseUrl ?? "http://invalid", cfg.token ?? "", cfg.timeoutMs);
        const db = dbPort(token, `worker-${crypto.randomUUID().slice(0, 8)}`);
        try {
          const r = await runEipTick(engine, db, cfg);
          return Response.json({ ok: true, ...r });
        } catch {
          return Response.json({ ok: false, error: "tick_failed" }, { status: 500 });
        }
      },
    },
  },
});
