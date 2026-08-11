/**
 * Discovery provider health + extraction telemetry (admin view).
 * Makes provider failure explicit so an outage is never read as "0 results".
 */

import type { DiscoveryRouterReport, ProviderHealthReport } from "@/lib/scan/discovery/types";
import type { ExtractionStats } from "@/lib/scan/page-extract-types";

const STATE_STYLES: Record<string, string> = {
  HEALTHY: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  NOT_CONFIGURED: "border-border/60 bg-muted/40 text-muted-foreground",
  RATE_LIMITED: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  CREDITS_EXHAUSTED: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  AUTH_ERROR: "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400",
  TIMEOUT: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  PROVIDER_ERROR: "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400",
  DISABLED: "border-border/60 bg-muted/40 text-muted-foreground",
};

export function DiscoveryHealthPanel({
  discovery,
  extraction,
}: {
  discovery?: DiscoveryRouterReport | null;
  extraction?: ExtractionStats | null;
}) {
  if (!discovery && !extraction) return null;

  return (
    <div className="mt-4 rounded-xl border border-border bg-card/60 px-4 py-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Discovery provider health
        </span>
        {discovery?.all_providers_down && (
          <span className="rounded-full border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">
            All web providers down
          </span>
        )}
      </div>

      {discovery && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">Provider</th>
                <th className="py-1 pr-3">Health</th>
                <th className="py-1 pr-3">Attempted</th>
                <th className="py-1 pr-3">Success</th>
                <th className="py-1 pr-3">Failed</th>
                <th className="py-1 pr-3">URLs</th>
                <th className="py-1 pr-3">Avg latency</th>
                <th className="py-1">Reason</th>
              </tr>
            </thead>
            <tbody>
              {discovery.providers.map((p: ProviderHealthReport) => (
                <tr key={p.provider} className="border-t border-border/50">
                  <td className="py-1 pr-3 font-semibold text-foreground">{p.provider}</td>
                  <td className="py-1 pr-3">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        STATE_STYLES[p.state] ?? STATE_STYLES.PROVIDER_ERROR
                      }`}
                    >
                      {p.state}
                    </span>
                  </td>
                  <td className="py-1 pr-3">{p.queriesAttempted}</td>
                  <td className="py-1 pr-3">{p.queriesSuccessful}</td>
                  <td className="py-1 pr-3">{p.queriesFailed}</td>
                  <td className="py-1 pr-3">{p.urlsReturned}</td>
                  <td className="py-1 pr-3">{p.latencyMsAvg ? `${p.latencyMsAvg}ms` : "—"}</td>
                  <td className="py-1 max-w-[280px] truncate text-muted-foreground">
                    {p.failureReason ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {extraction && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
          <span
            className={`rounded-full border px-2 py-0.5 font-bold uppercase tracking-wider ${
              extraction.CRAWL4AI_CONFIGURED ? STATE_STYLES.HEALTHY : STATE_STYLES.NOT_CONFIGURED
            }`}
          >
            Crawl4AI: {extraction.CRAWL4AI_CONFIGURED ? "configured" : "not configured"}
          </span>
          <span>
            crawl4ai {extraction.CRAWL4AI_SUCCESS}/{extraction.CRAWL4AI_ATTEMPTED} · fallback fetch{" "}
            {extraction.FETCH_SUCCESS}/{extraction.FETCH_FALLBACK_USED} · failed{" "}
            {extraction.FETCH_FAILED + extraction.CRAWL4AI_FAILED}
          </span>
          {typeof extraction.crawl4ai_avg_ms === "number" && extraction.crawl4ai_avg_ms > 0 && (
            <span>avg crawl {(extraction.crawl4ai_avg_ms / 1000).toFixed(1)}s</span>
          )}
          {(extraction.crawl4ai_circuit_open_skips ?? 0) > 0 && (
            <span className="text-amber-600 dark:text-amber-400">
              breaker open · {extraction.crawl4ai_circuit_open_skips} skipped
            </span>
          )}

          {!extraction.CRAWL4AI_CONFIGURED && extraction.crawl4ai_config_hint && (
            <span className="text-amber-600 dark:text-amber-400">
              {extraction.crawl4ai_config_hint}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
