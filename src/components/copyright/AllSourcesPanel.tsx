import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export type DiscoveredSource = {
  id: string;
  url: string;
  host: string | null;
  page_title: string | null;
  classification: string | null;
  content_type: string | null;
  domain_risk: string | null;
  confidence: number | null;
  checked: boolean;
  crawl_failure_reason: string | null;
  identity_evidence: string[];
  access_evidence: string[];
  quality_tags: string[];
  status:
    | "verified_piracy"
    | "insufficient_evidence"
    | "no_match"
    | "unreachable"
    | "historical_unreachable"
    | "historical_preserved";
  reason: string | null;
  discovery_query: string | null;
};

const STATUS: Record<
  DiscoveredSource["status"],
  { label: string; cls: string }
> = {
  verified_piracy: {
    label: "Verified unauthorized",
    cls: "border-destructive/50 text-destructive",
  },
  insufficient_evidence: {
    label: "Evidence incomplete",
    cls: "border-amber-500/50 text-amber-500",
  },
  no_match: { label: "No match on page", cls: "text-muted-foreground" },
  unreachable: { label: "Not reachable", cls: "border-border/60 text-muted-foreground" },
  historical_unreachable: {
    label: "Historical source unreachable",
    cls: "border-orange-500/50 text-orange-500",
  },
  historical_preserved: {
    label: "Historical evidence preserved",
    cls: "border-sky-500/50 text-sky-500",
  },
};

/**
 * Full list of every source the scan discovered and checked, with its
 * evidence status. Investigation surface only — no takedown action.
 */
export function AllSourcesPanel({ sources }: { sources: DiscoveredSource[] }) {
  if (!sources.length) {
    return (
      <p className="text-xs text-muted-foreground">
        No sources have been discovered and checked for this scan yet.
      </p>
    );
  }

  const counts = sources.reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline" className="text-[10px]">
          {sources.length} sources checked
        </Badge>
        {(Object.keys(STATUS) as DiscoveredSource["status"][])
          .filter((k) => counts[k])
          .map((k) => (
            <Badge key={k} variant="outline" className={`text-[10px] ${STATUS[k].cls}`}>
              {STATUS[k].label}: {counts[k]}
            </Badge>
          ))}
      </div>

      <ul className="space-y-2">
        {sources.map((s) => {
          const status = STATUS[s.status] ?? STATUS.no_match;
          return (
            <li
              key={s.id}
              className="rounded-lg border border-border/60 bg-card/50 p-3 backdrop-blur"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className={`text-[10px] ${status.cls}`}>
                  {status.label}
                </Badge>
                {s.host && (
                  <Badge variant="outline" className="text-[10px]">
                    {s.host}
                  </Badge>
                )}
                {s.content_type && (
                  <Badge variant="outline" className="text-[10px]">
                    {s.content_type.replace(/_/g, " ")}
                  </Badge>
                )}
                {s.domain_risk && (
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {s.domain_risk} risk
                  </Badge>
                )}
                {typeof s.confidence === "number" && (
                  <Badge variant="outline" className="text-[10px]">
                    {s.confidence}%
                  </Badge>
                )}
                {s.quality_tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-[10px]">
                    {tag}
                  </Badge>
                ))}
              </div>
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="mt-1.5 flex items-center gap-1 truncate text-xs text-primary hover:underline"
              >
                {s.url} <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
              {s.page_title && (
                <p className="truncate text-[11px] text-muted-foreground">{s.page_title}</p>
              )}
              <p className="mt-1 text-[11px] text-muted-foreground">
                {s.status === "historical_unreachable"
                  ? "Previously confirmed source could not be reached this scan. Historical evidence is preserved separately."
                  : s.status === "historical_preserved"
                    ? "Historical finding from a prior scan — not reconfirmed as currently active this scan."
                    : s.checked
                      ? "Page retrieved and checked."
                      : "Page could not be retrieved."}
                {s.crawl_failure_reason ? ` ${s.crawl_failure_reason}` : ""}
                {s.identity_evidence.length
                  ? ` Title identity: ${s.identity_evidence.join(", ")}.`
                  : ""}
                {s.access_evidence.length
                  ? ` Access evidence: ${s.access_evidence.slice(0, 2).join(" ")}.`
                  : ""}
              </p>
              {s.reason && (
                <p className="mt-1 text-[11px] text-muted-foreground">{s.reason}</p>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-muted-foreground">
        Investigation record for rights-holder review — not a final legal determination.
      </p>
    </div>
  );
}
