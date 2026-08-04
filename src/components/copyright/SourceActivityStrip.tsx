import {
  parseSourceActivity,
  type SourceActivityEntry,
  type SourceActivityStatus,
} from "@/lib/copyright/source-activity";

export interface SourceActivityStripProps {
  stats?: Record<string, unknown> | null;
}

function statusClasses(status: SourceActivityStatus): string {
  switch (status) {
    case "queued":
      return "border-border/50 bg-background/30 text-muted-foreground";
    case "searching":
      return "border-primary/40 bg-primary/10 text-primary";
    case "completed":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
    case "failed":
      return "border-destructive/40 bg-destructive/10 text-destructive";
    case "no_results":
      return "border-amber-500/40 bg-amber-500/10 text-amber-200";
    default:
      return "border-border/50 bg-background/30 text-muted-foreground";
  }
}

function Chip({ entry }: { entry: SourceActivityEntry }) {
  return (
    <div
      className={`rounded-md border px-2.5 py-1.5 text-[10px] ${statusClasses(entry.status)}`}
    >
      <div className="flex items-center gap-2">
        <span className="font-semibold">{entry.label}</span>
        <span className="uppercase tracking-wide opacity-80">{entry.status}</span>
      </div>
      <div className="mt-0.5 tabular-nums opacity-80">
        {entry.candidates} found · {entry.requests} reviewed
        {entry.failures > 0 ? ` · ${entry.failures} limited` : ""}
      </div>
    </div>
  );
}

export function SourceActivityStrip({ stats }: SourceActivityStripProps) {
  const entries = parseSourceActivity(stats);
  if (!entries.length) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        Investigation channels
      </p>
      <div className="flex flex-wrap gap-2">
        {entries.map((entry) => (
          <Chip key={entry.provider} entry={entry} />
        ))}
      </div>
    </div>
  );
}
