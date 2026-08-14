import { Badge } from "@/components/ui/badge";
import { JOB_STAGE_LABEL } from "@/lib/discovery/candidate-presentation";
import type { Database } from "@/integrations/supabase/types";

type JobRow = Database["public"]["Tables"]["asset_discovery_jobs"]["Row"];

/**
 * Real job counters straight from `asset_discovery_jobs`.
 * No synthetic percentages: only stage plus the counters the worker persisted.
 */
export function DiscoveryJobProgress({ job }: { job: JobRow | null }) {
  if (!job) {
    return (
      <div className="rounded-xl border border-border/60 bg-card/50 p-4 text-sm text-muted-foreground">
        No discovery run yet for this protected asset.
      </div>
    );
  }

  const counters = [
    { label: "Discovered", value: job.candidates_discovered },
    { label: "Fetched", value: job.candidates_fetched },
    { label: "Compared", value: job.candidates_fetched },
    { label: "Verified matches", value: job.candidates_verified },
    { label: "Rejected", value: job.candidates_rejected },
    { label: "Copyright matches", value: job.matches_created },
  ];

  return (
    <div className="rounded-xl border border-border/60 bg-card/50 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
          {JOB_STAGE_LABEL[job.stage ?? ""] ?? job.stage ?? "unknown stage"}
        </Badge>
        <Badge
          variant="outline"
          className={`text-[10px] uppercase tracking-wide ${
            job.status === "failed"
              ? "border-destructive/50 text-destructive"
              : job.status === "completed"
                ? "border-emerald-500/40 text-emerald-500"
                : "border-primary/50 text-primary"
          }`}
        >
          {job.status}
        </Badge>
        <span className="text-xs text-muted-foreground">
          started {job.started_at ? new Date(job.started_at).toLocaleString() : "—"}
          {job.completed_at ? ` · finished ${new Date(job.completed_at).toLocaleString()}` : ""}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {counters.map((c) => (
          <div key={c.label} className="rounded-lg border border-border/50 bg-background/40 p-2">
            <div className="text-lg font-semibold tabular-nums">{c.value ?? 0}</div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {c.label}
            </div>
          </div>
        ))}
      </div>

      {job.error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
          {job.error}
        </p>
      )}
    </div>
  );
}
