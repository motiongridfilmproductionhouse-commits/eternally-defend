import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { runAutoMonitor } from "@/lib/copyright/distribution-monitor.server";
import { deactivateStaleOfficialSources } from "@/lib/copyright/stale-official.server";

function incidentIsActive(evidence: unknown): boolean {
  if (!evidence || typeof evidence !== "object") return true;
  return (evidence as Record<string, unknown>).active !== false;
}

/** Live Unauthorized Distribution Monitor state: sources, incidents, history. */
export const getDistributionMonitor = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    // Soft-deactivate stale YouTube/Plex/catalog false positives (audit retained).
    const stale = await deactivateStaleOfficialSources(supabase, {
      userId,
      limit: 100,
    }).catch(() => ({ sourcesDeactivated: 0, incidentsDeactivated: 0 }));

    const [sources, incidents, runs] = await Promise.all([
      supabase.from("distribution_sources").select("*").order("last_seen_at", { ascending: false }).limit(200),
      supabase.from("distribution_incidents").select("*").order("detected_at", { ascending: false }).limit(100),
      supabase.from("distribution_monitor_runs").select("*").order("started_at", { ascending: false }).limit(100),
    ]);
    if (sources.error) throw new Error(sources.error.message);

    const rows = sources.data ?? [];
    // Non-deactivated sources (includes paused). Deactivated stale official FPs are excluded from counters.
    const liveRows = rows.filter((s) => s.status !== "deactivated");
    const monitoredRows = liveRows.filter((s) => s.monitor_enabled);
    const activeStatusRows = liveRows.filter((s) => s.status === "active");
    const activeIncidents = (incidents.data ?? []).filter((i) => incidentIsActive(i.evidence));
    const now = Date.now();
    return {
      sources: rows,
      incidents: incidents.data ?? [],
      runs: runs.data ?? [],
      staleCleanup: stale,
      stats: {
        total: liveRows.length,
        high: liveRows.filter((s) => s.risk_level === "high").length,
        active: activeStatusRows.length,
        monitored: monitoredRows.length,
        due: monitoredRows.filter((s) => Date.parse(s.next_check_at) <= now).length,
        newLast24h: liveRows.filter((s) => now - Date.parse(s.first_seen_at) < 86_400_000).length,
        incidents24h: activeIncidents.filter((i) => now - Date.parse(i.detected_at) < 86_400_000).length,
        deactivated: rows.filter((s) => s.status === "deactivated").length,
      },
    };
  });

/** Force an immediate re-crawl of one source, or a sweep of the due queue. */
export const runDistributionMonitorNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({
    sourceId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(15).optional(),
  }).parse(raw ?? {}))
  .handler(async ({ data, context }) =>
    runAutoMonitor(context.supabase, {
      userId: context.userId,
      sourceIds: data.sourceId ? [data.sourceId] : undefined,
      limit: data.sourceId ? 1 : (data.limit ?? 6),
      force: true,
      runType: "manual",
    }),
  );

/** Pause / resume monitoring for a source. */
export const setDistributionSourceMonitoring = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({
    sourceId: z.string().uuid(),
    monitorEnabled: z.boolean(),
  }).parse(raw))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("distribution_sources")
      .update({ monitor_enabled: data.monitorEnabled })
      .eq("id", data.sourceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
