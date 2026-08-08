import { useState, useMemo } from "react";
import {
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  AlertTriangle,
  FileQuestion,
  XCircle,
  Film,
  CheckCircle2,
  ExternalLink,
  Info,
  Layers,
  Bug,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { VerificationDiagnostics } from "@/lib/copyright/strict-movie-verification";

export interface CandidateDiagnosticsPanelProps {
  matches: Array<Record<string, unknown>>;
  stats?: Record<string, unknown> | null;
}

export function CandidateDiagnosticsPanel({
  matches,
  stats,
}: CandidateDiagnosticsPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterDecision, setFilterDecision] = useState<string>("all");

  const diagnosticsList = useMemo(() => {
    return matches.map((m, idx) => {
      const id = String(m.id ?? `cand-${idx}`);
      const ev = (m.evidence ?? {}) as Record<string, unknown>;
      const diag = (ev.verification_diagnostics ?? null) as VerificationDiagnostics | null;
      const url = String(m.source_url ?? m.url ?? "");
      const title = String(m.page_title ?? "");
      const confidence = Number(m.confidence ?? 0);
      const isClientVisible = ev.client_visible !== false;

      // Synthesize diagnostics if verification_diagnostics not explicitly saved on legacy rows
      const decision = diag?.verification_decision ?? (
        isClientVisible && confidence >= 85
          ? "VERIFIED_MOVIE_COPY"
          : confidence >= 65
            ? "PROBABLE_MOVIE_COPY"
            : "UNVERIFIED_LEAD"
      );

      return {
        id,
        rawMatch: m,
        diag: diag ?? {
          discovered_url: url,
          final_url: url,
          hostname: String(ev.host ?? new URL(url).hostname),
          http_status: 200,
          page_title: title || null,
          detected_movie_title: title || null,
          protected_movie_title: "Protected Movie",
          identity_match: confidence >= 50,
          identity_score: confidence,
          distribution_signal: confidence >= 70,
          distribution_signals_detected: Array.isArray(ev.distribution_links) ? ["distribution_links"] : [],
          final_url_verified: true,
          content_type: String(m.detection_type ?? "unknown"),
          verification_score: confidence,
          verification_decision: decision as VerificationDiagnostics["verification_decision"],
          rejection_reason: String(m.reason ?? "Pending candidate evidence grading."),
          promotional_content: decision === "REJECTED_PROMOTIONAL",
          different_work: decision === "DIFFERENT_WORK",
          embedded_player_detected: Boolean(ev.embedded_player),
          downloadable_file_detected: Boolean(ev.downloadable_file),
          torrent_or_magnet_detected: Boolean(ev.torrent_or_magnet),
          poster_match_score: null,
          ocr_title_evidence: null,
          evidence_signals: [],
          timestamp: new Date().toISOString(),
        },
      };
    });
  }, [matches]);

  const counters = useMemo(() => {
    const totalDiscovered = Number(stats?.candidates ?? stats?.candidate_pages ?? diagnosticsList.length);
    const totalFetched = Number(stats?.crawled_pages ?? stats?.pages_crawled ?? diagnosticsList.length);
    let fetchFailed = 0;
    let differentWork = 0;
    let promotional = 0;
    let official = 0;
    let insufficient = 0;
    let probable = 0;
    let verified = 0;

    for (const item of diagnosticsList) {
      const dec = item.diag.verification_decision;
      if (item.diag.http_status !== 200) fetchFailed++;
      if (dec === "VERIFIED_MOVIE_COPY") verified++;
      else if (dec === "PROBABLE_MOVIE_COPY") probable++;
      else if (dec === "DIFFERENT_WORK") differentWork++;
      else if (dec === "REJECTED_PROMOTIONAL") promotional++;
      else if (dec === "OFFICIAL_SOURCE") official++;
      else insufficient++;
    }

    return {
      discovered: Math.max(totalDiscovered, diagnosticsList.length),
      fetched: Math.max(totalFetched, diagnosticsList.length),
      fetchFailed,
      differentWork,
      promotional,
      official,
      insufficient,
      probable,
      verified,
    };
  }, [diagnosticsList, stats]);

  const filtered = useMemo(() => {
    if (filterDecision === "all") return diagnosticsList;
    return diagnosticsList.filter((d) => d.diag.verification_decision === filterDecision);
  }, [diagnosticsList, filterDecision]);

  return (
    <div className="space-y-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-xs">
      <div className="flex items-center justify-between border-b border-amber-500/20 pb-3">
        <div className="flex items-center gap-2 font-semibold text-amber-300">
          <Bug className="h-4 w-4 shrink-0 text-amber-400" />
          <span>ADMIN ONLY — Candidate Verification Diagnostics</span>
          <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-400">
            False Negative Diagnostic Mode
          </Badge>
        </div>
        <span className="text-[11px] text-muted-foreground">
          Showing internal evidence breakdown for all {diagnosticsList.length} candidate(s)
        </span>
      </div>

      {/* Counter Cards */}
      <div className="grid grid-cols-3 sm:grid-cols-9 gap-2">
        <div className="rounded-lg border border-border/50 bg-background/50 p-2 text-center">
          <div className="text-sm font-semibold">{counters.discovered}</div>
          <div className="text-[9px] text-muted-foreground">Discovered</div>
        </div>
        <div className="rounded-lg border border-border/50 bg-background/50 p-2 text-center">
          <div className="text-sm font-semibold text-sky-400">{counters.fetched}</div>
          <div className="text-[9px] text-muted-foreground">Fetched</div>
        </div>
        <div className="rounded-lg border border-border/50 bg-background/50 p-2 text-center">
          <div className="text-sm font-semibold text-destructive">{counters.fetchFailed}</div>
          <div className="text-[9px] text-muted-foreground">Fetch Failed</div>
        </div>
        <div className="rounded-lg border border-border/50 bg-background/50 p-2 text-center">
          <div className="text-sm font-semibold text-orange-400">{counters.differentWork}</div>
          <div className="text-[9px] text-muted-foreground">Different Work</div>
        </div>
        <div className="rounded-lg border border-border/50 bg-background/50 p-2 text-center">
          <div className="text-sm font-semibold text-blue-400">{counters.promotional}</div>
          <div className="text-[9px] text-muted-foreground">Promotional</div>
        </div>
        <div className="rounded-lg border border-border/50 bg-background/50 p-2 text-center">
          <div className="text-sm font-semibold text-muted-foreground">{counters.official}</div>
          <div className="text-[9px] text-muted-foreground">Official</div>
        </div>
        <div className="rounded-lg border border-border/50 bg-background/50 p-2 text-center">
          <div className="text-sm font-semibold text-amber-400">{counters.insufficient}</div>
          <div className="text-[9px] text-muted-foreground">Insufficient Ev.</div>
        </div>
        <div className="rounded-lg border border-border/50 bg-background/50 p-2 text-center">
          <div className="text-sm font-semibold text-purple-400">{counters.probable}</div>
          <div className="text-[9px] text-muted-foreground">Probable</div>
        </div>
        <div className="rounded-lg border border-border/50 bg-background/50 p-2 text-center">
          <div className="text-sm font-semibold text-emerald-400">{counters.verified}</div>
          <div className="text-[9px] text-muted-foreground">Verified</div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-1.5 pt-1">
        {[
          { id: "all", label: `All Candidates (${diagnosticsList.length})` },
          { id: "VERIFIED_MOVIE_COPY", label: `Verified (${counters.verified})` },
          { id: "PROBABLE_MOVIE_COPY", label: `Probable (${counters.probable})` },
          { id: "UNVERIFIED_LEAD", label: `Insufficient Evidence (${counters.insufficient})` },
          { id: "DIFFERENT_WORK", label: `Different Work (${counters.differentWork})` },
          { id: "REJECTED_PROMOTIONAL", label: `Promotional (${counters.promotional})` },
          { id: "OFFICIAL_SOURCE", label: `Official (${counters.official})` },
        ].map((tab) => (
          <Button
            key={tab.id}
            size="sm"
            variant={filterDecision === tab.id ? "default" : "outline"}
            className="h-6 text-[10px] px-2 py-0"
            onClick={() => setFilterDecision(tab.id)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {/* Candidate Rows */}
      <div className="space-y-2 pt-1">
        {filtered.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground">No candidate rows match this decision filter.</div>
        ) : (
          filtered.map((item) => {
            const isExpanded = expandedId === item.id;
            const d = item.diag;
            const isPass = d.verification_decision === "VERIFIED_MOVIE_COPY";

            let badgeVariant: "destructive" | "secondary" | "outline" | "default" = "outline";
            let badgeStyle = "border-amber-500/50 bg-amber-500/10 text-amber-400";
            if (isPass) {
              badgeStyle = "border-emerald-500/50 bg-emerald-500/10 text-emerald-400";
            } else if (d.verification_decision === "PROBABLE_MOVIE_COPY") {
              badgeStyle = "border-purple-500/50 bg-purple-500/10 text-purple-400";
            } else if (d.verification_decision === "DIFFERENT_WORK") {
              badgeStyle = "border-orange-500/50 bg-orange-500/10 text-orange-400";
            } else if (d.verification_decision === "REJECTED_PROMOTIONAL") {
              badgeStyle = "border-blue-500/50 bg-blue-500/10 text-blue-400";
            } else if (d.verification_decision === "OFFICIAL_SOURCE") {
              badgeStyle = "border-border/50 bg-muted/30 text-muted-foreground";
            }

            return (
              <div
                key={item.id}
                className="rounded-lg border border-border/60 bg-card/60 p-3 transition hover:border-amber-500/40"
              >
                <div
                  className="flex items-center justify-between gap-3 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="font-mono text-[11px] truncate text-foreground/90">
                      {d.discovered_url}
                    </span>
                    {d.final_url && d.final_url !== d.discovered_url && (
                      <Badge variant="outline" className="text-[9px] shrink-0 text-muted-foreground">
                        Redirected
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-semibold text-foreground">{d.verification_score}%</span>
                    <Badge variant={badgeVariant} className={`text-[10px] uppercase font-mono ${badgeStyle}`}>
                      {d.verification_decision}
                    </Badge>
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-3 space-y-3 border-t border-border/40 pt-3 text-[11px] font-mono">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-background/50 p-2.5 rounded border border-border/40">
                      <div>
                        <span className="text-muted-foreground">Identity: </span>
                        <span className={d.identity_match ? "text-emerald-400 font-semibold" : "text-destructive font-semibold"}>
                          {d.identity_match ? `PASS (${d.identity_score})` : `FAIL (${d.identity_score})`}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Distribution: </span>
                        <span className={d.distribution_signal ? "text-emerald-400 font-semibold" : "text-destructive font-semibold"}>
                          {d.distribution_signal ? "PASS" : "FAIL"}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Final URL: </span>
                        <span className={d.final_url_verified ? "text-emerald-400 font-semibold" : "text-destructive font-semibold"}>
                          {d.final_url_verified ? "PASS" : "FAIL"}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Embedded Player: </span>
                        <span className={d.embedded_player_detected ? "text-emerald-400 font-semibold" : "text-muted-foreground"}>
                          {d.embedded_player_detected ? "PASS" : "FAIL"}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Download File: </span>
                        <span className={d.downloadable_file_detected ? "text-emerald-400 font-semibold" : "text-muted-foreground"}>
                          {d.downloadable_file_detected ? "PASS" : "FAIL"}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Torrent/Magnet: </span>
                        <span className={d.torrent_or_magnet_detected ? "text-emerald-400 font-semibold" : "text-muted-foreground"}>
                          {d.torrent_or_magnet_detected ? "PASS" : "FAIL"}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Promotional: </span>
                        <span className={d.promotional_content ? "text-blue-400 font-semibold" : "text-muted-foreground"}>
                          {d.promotional_content ? "YES" : "NO"}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Different Work: </span>
                        <span className={d.different_work ? "text-orange-400 font-semibold" : "text-muted-foreground"}>
                          {d.different_work ? "YES" : "NO"}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-1 bg-background/50 p-2.5 rounded border border-border/40">
                      <div><span className="text-muted-foreground">Page Title: </span><span className="text-foreground">{d.page_title || "(none)"}</span></div>
                      <div><span className="text-muted-foreground">Detected Work Title: </span><span className="text-foreground">{d.detected_movie_title || "(none)"}</span></div>
                      <div><span className="text-muted-foreground">Protected Title: </span><span className="text-primary">{d.protected_movie_title}</span></div>
                      <div><span className="text-muted-foreground">Decision: </span><span className="font-semibold text-amber-400">{d.verification_decision}</span></div>
                      <div><span className="text-muted-foreground">Rejection Reason: </span><span className="text-destructive font-semibold">{d.rejection_reason}</span></div>
                      {d.distribution_signals_detected.length > 0 && (
                        <div>
                          <span className="text-muted-foreground">Distribution Signals Detected: </span>
                          <span className="text-emerald-400">{d.distribution_signals_detected.join(", ")}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex justify-end gap-2 pt-1">
                      <a
                        href={d.final_url || d.discovered_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        Inspect Raw Destination <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
