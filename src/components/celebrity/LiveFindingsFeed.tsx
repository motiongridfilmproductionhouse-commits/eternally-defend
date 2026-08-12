import { ExternalLink, ImageOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { RadarColor, RadarFinding } from "@/lib/celebrity/radar-model";

const DOT: Record<RadarColor, string> = {
  green: "bg-emerald-400",
  yellow: "bg-amber-300",
  orange: "bg-orange-400",
  red: "bg-red-500",
};

const ASSOCIATION_LABEL: Record<string, string> = {
  AUTHORIZED: "Authorized campaign use",
  REVIEW: "Needs review",
  POSSIBLE_UNAUTHORIZED_AD: "Possible unauthorized ad use",
  MISUSE: "Campaign misuse",
};

function formatReach(reach: number | null): string {
  if (reach === null) return "—";
  if (reach >= 1_000_000) return `${(reach / 1_000_000).toFixed(1)}M`;
  if (reach >= 1_000) return `${(reach / 1_000).toFixed(1)}K`;
  return String(reach);
}

function timeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

export function LiveFindingsFeed({
  nodes,
  onReview,
}: {
  nodes: RadarFinding[];
  onReview: (finding: RadarFinding) => void;
}) {
  return (
    <section className="cyber-panel relative overflow-hidden rounded-2xl p-5">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Live findings</h2>
          <p className="text-[11px] text-sky-300/80">
            Real detections from your reputation, likeness, deepfake, impersonation and copyright
            monitoring.
          </p>
        </div>
      </header>

      {nodes.length === 0 ? (
        <p className="mt-5 rounded-xl border border-sky-400/20 bg-sky-500/5 p-4 text-xs text-sky-200/80">
          No findings yet. As soon as a scan records something, it appears here with its evidence
          status.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {nodes.slice(0, 25).map((f) => (
            <li
              key={`${f.kind}:${f.id}`}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-sky-400/15 bg-slate-950/40 p-3"
            >
              <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-lg border border-sky-400/20 bg-slate-900/60">
                {f.thumbnailUrl ? (
                  <img
                    src={`/api/public/image-proxy?url=${encodeURIComponent(f.thumbnailUrl)}`}
                    alt={f.category}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <ImageOff className="h-4 w-4 text-sky-300/50" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[f.color]}`} />
                  <span className="truncate text-sm font-medium text-slate-100">
                    {f.title ?? f.url ?? f.category}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-sky-300/70">
                  <span>{f.platform}</span>
                  <span>{f.category}</span>
                  <span>
                    {f.evidenceStatus}
                    {f.confidence !== null ? ` · ${f.confidence}%` : ""}
                  </span>
                  <span>Reach {formatReach(f.reach)}</span>
                  <span>{timeAgo(f.detectedAt)}</span>
                  {f.campaignName && <span>Campaign: {f.campaignName}</span>}
                </div>
              </div>

              <Badge
                variant={f.association === "AUTHORIZED" ? "secondary" : "outline"}
                className="border-sky-400/30 text-[10px] uppercase tracking-wide text-sky-200"
              >
                {ASSOCIATION_LABEL[f.association] ?? f.association}
              </Badge>

              <Button
                size="sm"
                variant="outline"
                className="border-sky-500/30 bg-slate-950/60 text-sky-100 hover:bg-slate-900"
                onClick={() => onReview(f)}
              >
                Review Evidence <ExternalLink className="ml-1.5 size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default LiveFindingsFeed;
