/**
 * Pre-enrollment prospect scan worker. Continues scans on the server so they
 * never depend on a staff browser staying open.
 *
 * Callers (all server-side, all carrying the managed `prospect_scan_worker`
 * token from internal_cron_secrets in the Authorization header):
 *   - the AFTER INSERT trigger on prospect_scans (immediate kick, pg_net),
 *   - pg_cron every minute (safety net),
 *   - this hook itself, chaining while a scan still has work.
 *
 * No service-role credential: the token is verified by the database and the
 * worker then talks to Supabase with the publishable key plus the token
 * header, which RLS admits on the prospect scan tables only. Each call
 * responds 202 immediately and runs one bounded tick in the background; the
 * per-scan lease makes overlapping calls harmless.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

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
        const { workerConfigAvailable, presentedWorkerToken, verifyWorkerToken, createWorkerDb } =
          await import("@/lib/prospect/worker-client.server");
        if (!workerConfigAvailable()) {
          return Response.json(
            { ok: false, error: "supabase_public_config_missing" },
            { status: 503 },
          );
        }

        const token = presentedWorkerToken(request);
        if (!token || !(await verifyWorkerToken(token))) {
          return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        }

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
            const db = createWorkerDb(token);
            const tick = await runProspectWorkerTick({ db, budgetMs: TICK_BUDGET_MS, scanId });
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
                token,
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
