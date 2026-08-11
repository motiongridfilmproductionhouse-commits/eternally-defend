import { useMemo } from "react";
import { BarChart3, ExternalLink } from "lucide-react";
import type { ClientFinding } from "@/lib/deepfake/results-dashboard";
import { buildSourceIntelligenceList } from "@/lib/deepfake/analytics-helpers";
import { Badge } from "@/components/ui/badge";

interface Props {
  findings: ClientFinding[];
  selectedDomain?: string | null;
  onSelectDomain?: (domain: string | null) => void;
}

export function DomainConcentrationChart({ findings, selectedDomain, onSelectDomain }: Props) {
  const sources = useMemo(() => buildSourceIntelligenceList(findings), [findings]);

  const maxCount = useMemo(
    () => (sources.length > 0 ? Math.max(...sources.map((s) => s.totalFindings)) : 1),
    [sources],
  );

  const totalQualifying = useMemo(
    () => sources.reduce((acc, s) => acc + s.totalFindings, 0),
    [sources],
  );

  return (
    <section className="card-surface p-5 rounded-2xl border border-border/80 bg-card text-foreground space-y-4">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-xl grid place-items-center bg-primary/10 border border-primary/20 text-primary">
            <BarChart3 className="size-4" />
          </div>
          <div>
            <div className="text-[10px] tracking-[0.2em] font-semibold text-muted-foreground uppercase">
              DOMAIN CONCENTRATION
            </div>
            <h3 className="text-sm font-bold text-foreground">Top Exposure Sources</h3>
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          {sources.length} website{sources.length === 1 ? "" : "s"} hosting target content
        </div>
      </header>

      {sources.length === 0 ? (
        <div className="p-8 text-center text-xs text-muted-foreground border border-dashed border-border/60 rounded-xl">
          No qualifying domain concentration data yet.
        </div>
      ) : (
        <div className="space-y-3">
          {sources.slice(0, 8).map((source) => {
            const pct = Math.round((source.totalFindings / Math.max(1, maxCount)) * 100);
            const totalPct = Math.round((source.totalFindings / Math.max(1, totalQualifying)) * 100);
            const isSelected = selectedDomain === source.domain;

            return (
              <div
                key={source.domain}
                onClick={() => onSelectDomain && onSelectDomain(isSelected ? null : source.domain)}
                className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                  isSelected
                    ? "border-primary bg-primary/10 shadow-md ring-1 ring-primary/40"
                    : "border-border/60 hover:bg-secondary/40 hover:border-border"
                }`}
              >
                <div className="flex items-center justify-between text-xs mb-1.5 gap-2">
                  <div className="flex items-center gap-2 truncate">
                    <span className="font-semibold text-foreground truncate flex items-center gap-1.5">
                      <span>{source.geo.countryFlag}</span>
                      <span>{source.domain}</span>
                    </span>
                    <Badge
                      variant="outline"
                      className={`text-[9px] px-1.5 py-0 border ${
                        source.highestRisk === "CRITICAL"
                          ? "border-red-500/40 text-red-400 bg-red-500/10"
                          : source.highestRisk === "HIGH"
                            ? "border-amber-500/40 text-amber-400 bg-amber-500/10"
                            : "border-sky-500/40 text-sky-300 bg-sky-500/10"
                      }`}
                    >
                      {source.highestRisk}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 text-xs">
                    <span className="text-muted-foreground text-[11px]">{totalPct}% of exposure</span>
                    <span className="font-extrabold text-primary tabular-nums">
                      {source.totalFindings} finding{source.totalFindings === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>

                {/* Progress Bar in Eterna Electric Blue */}
                <div className="h-2 w-full rounded-full bg-secondary/80 overflow-hidden relative">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      isSelected
                        ? "bg-gradient-to-r from-sky-400 to-blue-600"
                        : "bg-gradient-to-r from-sky-500/80 to-blue-500/80"
                    }`}
                    style={{ width: `${Math.max(4, pct)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
