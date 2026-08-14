import { ExternalLink, ImageOff, Loader2, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EvidenceThumbnail } from "@/components/copyright/EvidenceThumbnail";
import { proxiedReferenceImageUrl } from "@/lib/copyright/reference-images";
import { candidateState, similarityLabel } from "@/lib/discovery/candidate-presentation";
import type { Database } from "@/integrations/supabase/types";

type CandidateRow = Database["public"]["Tables"]["discovery_candidates"]["Row"];

export interface LinkedMatch {
  id: string;
  review_status: string;
  confidence_band: string;
  confidence: number | null;
  source_url: string;
}

export interface DiscoveryCandidateListProps {
  candidates: CandidateRow[];
  matches: LinkedMatch[];
  assetName: string;
  onSendToCase?: (matchId: string) => void;
  sendingMatchId?: string | null;
}

export function DiscoveryCandidateList({
  candidates,
  matches,
  assetName,
  onSendToCase,
  sendingMatchId,
}: DiscoveryCandidateListProps) {
  const matchById = new Map(matches.map((m) => [m.id, m]));

  if (!candidates.length) {
    return (
      <div className="rounded-xl border border-border/60 bg-card/50 p-6 text-sm text-muted-foreground">
        No discovery candidates recorded for this protected asset yet.
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-3">
      {candidates.map((c) => {
        const state = candidateState(c);
        const match = c.copyright_match_id ? matchById.get(c.copyright_match_id) : undefined;
        const sim = similarityLabel(
          c.similarity == null ? null : Number(c.similarity),
          c.distance ?? null,
        );
        return (
          <article
            key={c.id}
            data-testid="discovery-candidate-card"
            className="min-w-0 overflow-hidden rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur space-y-3"
          >
            <div className="flex gap-4 min-w-0">
              {c.media_url || c.screenshot_url ? (
                <EvidenceThumbnail
                  src={proxiedReferenceImageUrl(c.screenshot_url ?? c.media_url!)}
                  alt={`Discovered media for ${assetName}`}
                />
              ) : (
                <div className="grid size-20 shrink-0 place-items-center rounded-lg border border-border/60 bg-background/40 text-muted-foreground">
                  <ImageOff className="h-5 w-5" />
                </div>
              )}

              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={`text-[10px] ${state.className}`}>
                    {state.label}
                  </Badge>
                  {c.platform && (
                    <Badge variant="outline" className="text-[10px]">
                      {c.platform}
                    </Badge>
                  )}
                  {c.host && (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">
                      {c.host}
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    {c.provider}
                    {c.match_type ? ` · ${c.match_type}` : ""}
                  </Badge>
                  {sim && (
                    <Badge variant="outline" className="text-[10px]">
                      {sim}
                      {c.algorithm ? ` · ${c.algorithm}` : ""}
                    </Badge>
                  )}
                </div>

                {/* The actionable page URL is the identity of the finding. */}
                <a
                  href={c.page_url ?? c.canonical_page_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 truncate text-sm font-medium text-primary hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{c.page_url ?? c.canonical_page_url}</span>
                </a>
                {c.page_title && (
                  <p className="truncate text-xs text-muted-foreground">{c.page_title}</p>
                )}

                {c.media_url && (
                  <p className="break-all text-[11px] text-muted-foreground">
                    Technical evidence (media/CDN URL): {c.media_url}
                  </p>
                )}

                <p className="text-[11px] text-muted-foreground">
                  Protected work: <span className="text-foreground">{assetName}</span> · first seen{" "}
                  {c.first_seen_at ? new Date(c.first_seen_at).toLocaleString() : "—"} · last seen{" "}
                  {c.last_seen_at ? new Date(c.last_seen_at).toLocaleString() : "—"}
                </p>

                <p className="text-[11px] text-muted-foreground">{state.hint}</p>
                {c.match_reason && (
                  <p className="break-words text-[11px] text-muted-foreground">Reason: {c.match_reason}</p>
                )}
                {c.crawl_failure_reason && (
                  <p className="text-[11px] text-destructive">
                    Retrieval failure: {c.crawl_failure_reason}
                  </p>
                )}
              </div>
            </div>

            {match && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/50 bg-background/40 p-2">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
                  <span>
                    Linked copyright match · {match.confidence_band} ·{" "}
                    {match.review_status.replace(/_/g, " ")}
                    {match.confidence != null ? ` · ${Math.round(match.confidence)}%` : ""}
                  </span>
                </div>
                {onSendToCase && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={sendingMatchId === match.id}
                    onClick={() => onSendToCase(match.id)}
                  >
                    {sendingMatchId === match.id ? (
                      <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                    ) : null}
                    Send to case
                  </Button>
                )}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
