/**
 * Pre-enrollment prospect scan worker. Continues scans on the server so they
 * never depend on a staff browser staying open.
 *
 * Callers: the staff start/rescan request, this hook itself (chaining while a
 * scan has work left) and pg_cron every minute as a safety net. Each call
 * responds 202 immediately and runs one bounded tick in the background; the
 * per-scan lease makes overlapping calls harmless.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  authorizeCronRequest,
  cronAuthResponse,
  requireTrustedRuntime,
} from "@/lib/protection/cron-auth.server";

const BodySchema = z
  .object({
    scan_id: z.string().uuid().nullable().optional(),
    hop: z.number().int().min(0).max(10_000).optional(),
  })
  .passthrough();

const TICK_BUDGET_MS = 22_000;

export const Route = createFileRoute("/api/public/hooks/prospect-scan-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const runtime = requireTrustedRuntime();
        if (!runtime.ok) return runtime.response;

        const auth = await authorizeCronRequest(request, {
          jobName: "prospect_scan_worker",
          envSecrets: [process.env.PROSPECT_SCAN_WORKER_SECRET, process.env.CRON_SECRET],
        });
        if (!auth.ok) return cronAuthResponse(auth);

        let body: z.infer<typeof BodySchema> = {};
        try {
          const raw = await request.text();
          body = raw.trim() ? BodySchema.parse(JSON.parse(raw)) : {};
        } catch {
          return Response.json({ ok: false, error: "invalid_body" }, { status: 400 });
        }
        const hop = body.hop ?? 0;
        const scanId = body.scan_id ?? undefined;
        const origin = new URL(request.url).origin;

        const {
          runProspectWorkerTick,
          dispatchProspectWorker,
          resolveWorkerOrigin,
          shouldChain,
          keepAlive,
        } = await import("@/lib/prospect/worker.server");

        const work = (async () => {
          try {
            const tick = await runProspectWorkerTick({ budgetMs: TICK_BUDGET_MS, scanId });
            console.info("[prospect-worker] tick", {
              hop,
              scan_id: scanId ?? null,
              advanced: tick.advanced.length,
              expired: tick.expired.length,
              units: tick.unitsRun,
              remaining: tick.remaining,
            });
            if (shouldChain({ remaining: tick.remaining, unitsRun: tick.unitsRun, hop })) {
              await dispatchProspectWorker({
                origin: resolveWorkerOrigin(origin),
                scanId,
                hop: hop + 1,
              });
            }
          } catch (err) {
            console.error(
              "[prospect-worker] tick failed",
              err instanceof Error ? err.message : err,
            );
          }
        })();
        await keepAlive(work);

        return Response.json({ ok: true, accepted: true, hop }, { status: 202 });
      },
    },
  },
});
