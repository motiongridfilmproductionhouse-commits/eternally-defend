/**
 * Investigation statistics dashboard for Deepfake Intelligence scans.
 */

import {
  parseProviderStatsFromMetrics,
  providerLabel,
  type ReferenceImageProviderStats,
} from "@/lib/deepfake/reference-images";
import {
  diagnosticsFromMetrics,
  formatProviderStatsLines,
  INVESTIGATION_TIMELINE_STAGES,
  type InvestigationDiagnostics,
} from "@/lib/deepfake/scan-diagnostics";
import {
  formatGoogleImagesDiagnosticLines,
  googleImagesBackgroundProgress,
  googleImagesBackgroundStatus,
  parseGoogleImagesDiagnostics,
} from "@/lib/deepfake/google-images-diagnostics";

export function buildInvestigationDiagnostics(
  metrics: Record<string, unknown> | null | undefined,
): InvestigationDiagnostics {
  const d = diagnosticsFromMetrics(metrics);
  const stats =
    d.provider_stats.length > 0 ? d.provider_stats : parseProviderStatsFromMetrics(metrics);
  return { ...d, provider_stats: stats };
}

export function InvestigationStatsPanel({
  metrics,
  status,
}: {
  metrics: Record<string, unknown> | null | undefined;
  status?: string | null;
}) {
  const d = buildInvestigationDiagnostics(metrics);
  const google = parseGoogleImagesDiagnostics(metrics);
  const googleBackground = googleImagesBackgroundStatus(metrics);
  const googleProgress = googleImagesBackgroundProgress(metrics);
  const stageLabel =
    INVESTIGATION_TIMELINE_STAGES.find((s) => s.key === d.investigation_stage)?.label ??
    (typeof d.investigation_stage === "string" ? d.investigation_stage : "Investigating…");

  return (
    <div className="space-y-4" data-testid="deepfake-investigation-stats">
      {status === "running" && (
        <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-primary">
          {stageLabel}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label="Reference Images" value={d.reference_images} />
        <StatCard label="Embeddings" value={d.embeddings} />
        <StatCard label="Aliases Generated" value={d.aliases_generated} />
        <StatCard label="Queries Generated" value={d.queries_generated} />
        <StatCard label="Providers Used" value={d.providers_used} />
        <StatCard label="Pages Crawled" value={d.pages_crawled} />
        <StatCard label="Images Compared" value={d.images_compared} />
        <StatCard label="Verified Matches" value={d.verified_matches} />
        <StatCard label="Potential Matches" value={d.potential_matches} />
        <StatCard label="Rejected" value={d.rejected_matches} />
        <StatCard label="Domains" value={d.domains_investigated} />
        <StatCard
          label="Coverage"
          value={d.coverage_score_percent != null ? `${d.coverage_score_percent}%` : "—"}
        />
      </div>

      {googleBackground === "queued" || googleBackground === "running" ? (
        <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-3 text-sm">
          <div className="font-medium text-primary">Google Images Investigation Running</div>
          <div className="mt-2 text-xs text-muted-foreground space-y-1">
            <div>
              {googleProgress.completed} / {googleProgress.total} Google queries completed
            </div>
            <div>{google.images_discovered} images collected</div>
            <div>{google.face_comparisons} face comparisons completed</div>
            <div>{google.evidence_packages_created} evidence packages generated</div>
            <div className="pt-1 text-primary/80">
              Background investigation continues… ({googleProgress.percent}%)
            </div>
          </div>
        </div>
      ) : null}

      {(() => {
        const startup =
          metrics?.startup_diagnostic && typeof metrics.startup_diagnostic === "object"
            ? (metrics.startup_diagnostic as Record<string, unknown>)
            : null;
        if (!startup) return null;
        return (
          <div className="rounded-md border border-border/70 bg-secondary/20 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-2">
              Startup Diagnostics
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              {typeof startup.stage === "string" && <div>Stage: {startup.stage}</div>}
              {typeof startup.mode === "string" && <div>Dispatch mode: {startup.mode}</div>}
              {typeof startup.worker_url === "string" && (
                <div>Worker URL: {startup.worker_url}</div>
              )}
              {typeof startup.category === "string" && (
                <div>Error category: {startup.category}</div>
              )}
              {typeof startup.reason === "string" && <div>Reason: {startup.reason}</div>}
              {typeof startup.http_status === "number" && (
                <div>HTTP status: {startup.http_status}</div>
              )}
              {typeof startup.request_id === "string" && (
                <div>Request ID: {startup.request_id}</div>
              )}
            </div>
          </div>
        );
      })()}

      {google.provider_status !== "not_started" && (
        <div className="rounded-md border border-border/70 bg-secondary/20 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-2">
            Google Images
          </div>
          <div className="text-xs text-muted-foreground space-y-1">
            {formatGoogleImagesDiagnosticLines(google).map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        </div>
      )}

      {d.provider_stats.length > 0 && (
        <div className="rounded-md border border-border/70 bg-secondary/20 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-2">
            Reference Image Sources
          </div>
          <div className="space-y-2">
            {d.provider_stats
              .filter((s) => s.configured || s.images_found > 0)
              .map((s) => (
                <ProviderStatRow key={s.provider} stat={s} />
              ))}
          </div>
          <div className="mt-3 text-sm font-semibold">
            Final Reference Images: {d.reference_images}
          </div>
        </div>
      )}

      {d.confidence_label && (
        <div className="text-xs text-muted-foreground">
          Confidence: <span className="capitalize font-medium">{d.confidence_label}</span>
        </div>
      )}

      {formatProviderStatsLines(d.provider_stats).length > 0 && (
        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer">Provider detail log</summary>
          <ul className="mt-2 list-disc pl-4 space-y-1">
            {formatProviderStatsLines(d.provider_stats).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border border-border/60 bg-background/40 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-semibold">{value}</div>
    </div>
  );
}

function ProviderStatRow({ stat }: { stat: ReferenceImageProviderStats }) {
  return (
    <div className="text-xs border-b border-border/40 pb-2 last:border-0">
      <div className="font-medium">{providerLabel(stat.provider)}</div>
      <div className="text-muted-foreground mt-0.5 grid grid-cols-2 gap-x-4 gap-y-0.5">
        <span>Found: {stat.images_found}</span>
        <span>Downloaded: {stat.images_downloaded}</span>
        <span>Accepted: {stat.images_accepted}</span>
        <span>Duplicates removed: {stat.duplicates_removed}</span>
        <span>Embeddings: {stat.images_used_for_embeddings}</span>
      </div>
    </div>
  );
}
