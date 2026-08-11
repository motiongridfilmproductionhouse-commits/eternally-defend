import { useState, useMemo } from "react";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  ShieldAlert,
  ShieldCheck,
  Globe,
  Trash2,
  CheckCircle,
  Copy,
  Clock,
  Building2,
  Check,
} from "lucide-react";
import type { ClientFinding } from "@/lib/deepfake/results-dashboard";
import { buildSourceIntelligenceList, type SourceIntelligence } from "@/lib/deepfake/analytics-helpers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface Props {
  findings: ClientFinding[];
  selectedDomain?: string | null;
  onUpdateFinding?: (findingId: string, status: "reviewed" | "dismissed" | "queued_takedown") => void;
  pending?: boolean;
}

export function SourceIntelligencePanel({
  findings,
  selectedDomain,
  onUpdateFinding,
  pending = false,
}: Props) {
  const sources = useMemo(() => buildSourceIntelligenceList(findings), [findings]);
  const [expandedDomains, setExpandedDomains] = useState<Record<string, boolean>>({});
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const toggleDomain = (dom: string) => {
    setExpandedDomains((prev) => ({ ...prev, [dom]: !prev[dom] }));
  };

  const copyLink = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    toast.success("URL copied to clipboard");
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  return (
    <section className="card-surface p-5 rounded-2xl border border-border/80 bg-card text-foreground space-y-4">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-xl grid place-items-center bg-primary/10 border border-primary/20 text-primary">
            <Building2 className="size-4" />
          </div>
          <div>
            <div className="text-[10px] tracking-[0.2em] font-semibold text-muted-foreground uppercase">
              SOURCE INTELLIGENCE
            </div>
            <h3 className="text-sm font-bold text-foreground">Domain Infrastructure & Target URL Breakdown</h3>
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          {sources.length} total source host{sources.length === 1 ? "" : "s"}
        </div>
      </header>

      {sources.length === 0 ? (
        <div className="p-8 text-center text-xs text-muted-foreground border border-dashed border-border/60 rounded-xl">
          No qualifying target findings available for source intelligence breakdown.
        </div>
      ) : (
        <div className="space-y-3">
          {sources.map((source) => {
            const isExpanded = expandedDomains[source.domain] || selectedDomain === source.domain;

            return (
              <div
                key={source.domain}
                className={`rounded-xl border transition-all overflow-hidden ${
                  selectedDomain === source.domain
                    ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                    : "border-border/60 bg-background/60"
                }`}
              >
                {/* Domain Header Row */}
                <div
                  onClick={() => toggleDomain(source.domain)}
                  className="p-3 sm:p-4 flex items-center justify-between gap-3 cursor-pointer hover:bg-secondary/30 transition select-none flex-wrap sm:flex-nowrap"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <button className="text-muted-foreground hover:text-foreground shrink-0">
                      {isExpanded ? (
                        <ChevronDown className="size-4 text-primary" />
                      ) : (
                        <ChevronRight className="size-4" />
                      )}
                    </button>

                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-foreground flex items-center gap-1.5 truncate">
                          <span>{source.geo.countryFlag}</span>
                          <span>{source.domain}</span>
                        </span>

                        <Badge
                          variant="outline"
                          className={`text-[9px] px-1.5 py-0 uppercase border ${
                            source.status === "TAKEDOWN_QUEUED"
                              ? "border-orange-500/40 text-orange-400 bg-orange-500/10"
                              : source.status === "IN_REVIEW"
                                ? "border-sky-500/40 text-sky-300 bg-sky-500/10"
                                : source.status === "REMOVED"
                                  ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
                                  : "border-red-500/40 text-red-400 bg-red-500/10"
                          }`}
                        >
                          {source.status.replace("_", " ")}
                        </Badge>
                      </div>

                      <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
                        <span>Provider: <strong className="text-foreground">{source.geo.hostingProvider}</strong></span>
                        {source.geo.countryName && (
                          <span>Region: <strong className="text-foreground">{source.geo.countryName}</strong></span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 text-xs">
                    <div className="text-right space-y-0.5">
                      <div className="font-extrabold text-foreground text-sm tabular-nums">
                        {source.totalFindings} Target Finding{source.totalFindings === 1 ? "" : "s"}
                      </div>
                      <div className="text-[10px] text-muted-foreground flex items-center justify-end gap-1.5">
                        <span className="text-red-400 font-semibold">{source.verifiedCount} Verified</span>
                        <span>•</span>
                        <span className="text-amber-400 font-semibold">{source.probableCount} Probable</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Expandable URLs Drawer */}
                {isExpanded && (
                  <div className="border-t border-border/60 bg-secondary/15 p-3 sm:p-4 space-y-3">
                    <div className="text-[10px] tracking-[0.16em] font-semibold text-muted-foreground uppercase flex items-center justify-between">
                      <span>QUALIFYING TARGET URLs FOR {source.domain.toUpperCase()} ({source.urls.length})</span>
                      {source.latestDetected && (
                        <span className="flex items-center gap-1 text-[10px] font-normal text-muted-foreground">
                          <Clock className="size-3" /> Latest detected: {new Date(source.latestDetected).toLocaleString()}
                        </span>
                      )}
                    </div>

                    <ul className="space-y-2">
                      {source.urls.map((u) => (
                        <li
                          key={u.id}
                          className="p-3 rounded-lg border border-border/50 bg-background/80 hover:border-border transition space-y-2 text-xs"
                        >
                          <div className="flex items-start justify-between gap-2 flex-wrap">
                            <div className="min-w-0 space-y-1">
                              <a
                                href={u.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-semibold text-primary hover:underline flex items-center gap-1.5 truncate max-w-xl"
                              >
                                <span className="truncate">{u.title}</span>
                                <ExternalLink className="size-3 shrink-0" />
                              </a>
                              <div className="flex items-center gap-2 flex-wrap text-[10px]">
                                <Badge
                                  className={`text-[9px] font-bold uppercase border ${
                                    u.origin === "NEW_DISCOVERY"
                                      ? "bg-sky-500/20 text-sky-300 border-sky-500/50"
                                      : u.origin === "MANUAL_EVIDENCE"
                                        ? "bg-purple-500/20 text-purple-300 border-purple-500/50"
                                        : "bg-slate-700/40 text-slate-300 border-slate-600/50"
                                  }`}
                                >
                                  {u.origin.replace("_", " ")}
                                </Badge>
                                <span className="text-muted-foreground truncate font-mono">{u.url}</span>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-[10px] px-2 border-border/60 hover:bg-secondary"
                                onClick={() => copyLink(u.url)}
                              >
                                {copiedUrl === u.url ? (
                                  <Check className="size-3 text-emerald-500 mr-1" />
                                ) : (
                                  <Copy className="size-3 mr-1" />
                                )}
                                {copiedUrl === u.url ? "Copied" : "Copy URL"}
                              </Button>

                              {onUpdateFinding && u.reviewStatus !== "queued_takedown" && (
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  className="h-7 text-[10px] px-2 bg-red-600 hover:bg-red-700"
                                  disabled={pending}
                                  onClick={() => onUpdateFinding(u.id, "queued_takedown")}
                                >
                                  <Trash2 className="size-3 mr-1" /> Queue Takedown
                                </Button>
                              )}
                            </div>
                          </div>

                          {/* Chips Metadata */}
                          <div className="flex items-center gap-2 flex-wrap text-[10px] pt-1">
                            <span className="px-2 py-0.5 rounded bg-secondary/60 border border-border/40 font-semibold text-foreground">
                              Identity Match: {u.faceSimilarity.toFixed(1)}%
                            </span>
                            <span className="px-2 py-0.5 rounded bg-secondary/60 border border-border/40 font-semibold text-purple-300">
                              Synthetic: {u.syntheticConfidence.toFixed(1)}%
                            </span>
                            <span className="px-2 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/30 font-semibold">
                              Explicit Media: {u.explicitDetected ? "CONFIRMED" : "CLEAN"}
                            </span>
                            {u.matchedKeywords.length > 0 && (
                              <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                                Keywords: {u.matchedKeywords.join(", ")}
                              </span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
