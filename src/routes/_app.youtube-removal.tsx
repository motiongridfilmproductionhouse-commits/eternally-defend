import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import {
  AlertTriangle,
  ExternalLink,
  Eye,
  RefreshCw,
  ShieldAlert,
  Youtube,
  Activity,
  ShieldCheck,
  Database,
  Wrench,
  Newspaper,
  Filter,
  Info,
  Layers,
} from "lucide-react";
import {
  getYoutubeRemovalScan,
  listYoutubeRemovalScans,
  retryYoutubeRemovalScan,
  startYoutubeRemovalScan,
} from "@/lib/youtube-removal/removal.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SourceScope, formatNewsSafetyNote } from "@/lib/youtube-removal/news-intelligence";

export interface FindingItem {
  id: string;
  scan_id: string;
  video_id: string;
  video_url: string;
  title: string;
  description?: string | null;
  channel_id?: string | null;
  channel_title: string;
  published_at?: string | null;
  thumbnail_url?: string | null;
  view_count?: number | null;
  like_count?: number | null;
  comment_count?: number | null;
  duration_seconds?: number | null;
  is_unavailable?: boolean;
  channel_class: string;
  subject_status: string;
  subject_confidence: number;
  verification_reason?: string;
  content_types: string[];
  risk_level: string;
  removal_potential: string;
  potential_violation?: string | null;
  problematic_claim?: string | null;
  assessment_reason?: string;
  recommended_action?: string;
  recommended_route?: string | null;
  evidence_needed?: string | null;
  evidence_timestamps?: any[];
  evidence_verified?: boolean;
  transcript_state?: string | null;
  transcript_language?: string | null;
  priority_score: number;
  discovery_queries: string[];
  source_type?: string;
  is_official_news?: boolean;
  is_official_news_allegation?: boolean;
  allegation_matched?: boolean;
  allegation_signals?: string[];
  news_topic_tags?: string[];
}

export const Route = createFileRoute("/_app/youtube-removal")({
  head: () => ({
    meta: [
      { title: "YouTube Removal Intelligence | Eterna" },
      {
        name: "description",
        content:
          "Discover, verify and assess non-official YouTube videos about a protected person and identify credible takedown candidates.",
      },
      { property: "og:title", content: "YouTube Removal Intelligence | Eterna" },
      {
        property: "og:description",
        content:
          "Evidence-based YouTube defamation and removal-candidate analysis with verified transcript evidence.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: YoutubeRemovalPage,
});

const removalTone: Record<string, string> = {
  high: "bg-destructive/15 text-destructive border-destructive/40",
  medium: "bg-amber-500/15 text-amber-400 border-amber-500/40",
  low: "bg-muted text-muted-foreground border-border",
  not_eligible: "bg-muted text-muted-foreground border-border",
};

function formatNumber(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString();
}

function YoutubeRemovalPage() {
  const [name, setName] = useState("");
  const [sourceScope, setSourceScope] = useState<SourceScope>("NON_OFFICIAL_ONLY");
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [activeScanId, setActiveScanId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const isDiagMode =
    typeof window !== "undefined" &&
    (window.location.search.includes("diag=1") || process.env.NODE_ENV === "development");

  const listFn = useServerFn(listYoutubeRemovalScans);
  const getFn = useServerFn(getYoutubeRemovalScan);
  const startFn = useServerFn(startYoutubeRemovalScan);
  const retryFn = useServerFn(retryYoutubeRemovalScan);

  const scans = useQuery({ queryKey: ["yt-removal", "scans"], queryFn: () => listFn({}) });

  const scanDetail = useQuery({
    queryKey: ["yt-removal", "scan", activeScanId, sourceScope],
    queryFn: () => getFn({ data: { scanId: activeScanId!, sourceScope } }),
    enabled: !!activeScanId,
    refetchInterval: (q) =>
      q.state.data?.scan?.status === "running" || q.state.data?.scan?.status === "queued" ? 4000 : false,
  });

  const start = useMutation({
    mutationFn: async () => startFn({ data: { targetName: name.trim(), sourceScope } }),
    onSuccess: (res) => {
      setActiveScanId(res.scanId);
      void queryClient.invalidateQueries({ queryKey: ["yt-removal", "scans"] });
    },
  });

  const retry = useMutation({
    mutationFn: async (scanId: string) => retryFn({ data: { scanId } }),
    onSuccess: () => void scanDetail.refetch(),
  });

  const scan = scanDetail.data?.scan;
  const rawFindings: FindingItem[] = (scanDetail.data?.findings as any) ?? [];
  const telemetry = scanDetail.data?.telemetry;

  const filteredFindings = useMemo(() => {
    switch (clientFilter) {
      case "independent":
        return rawFindings.filter((f) => f.channel_class !== "official_news");
      case "news":
        return rawFindings.filter((f) => f.channel_class === "official_news");
      case "allegations":
        return rawFindings.filter((f) => f.allegation_matched || (f.news_topic_tags && f.news_topic_tags.length > 0));
      case "investigations":
        return rawFindings.filter((f) => f.news_topic_tags?.includes("INVESTIGATION"));
      case "scam_fraud":
        return rawFindings.filter((f) => f.news_topic_tags?.includes("SCAM_ALLEGATION") || f.news_topic_tags?.includes("FRAUD_ALLEGATION"));
      case "legal":
        return rawFindings.filter((f) => f.news_topic_tags?.includes("LEGAL_CASE") || f.recommended_action?.includes("LEGAL"));
      case "monitoring":
        return rawFindings.filter((f) => f.recommended_action === "MONITOR" || f.removal_potential === "not_eligible");
      case "actionable":
        return rawFindings.filter((f) => f.removal_potential === "high" || f.removal_potential === "medium");
      case "all":
      default:
        return rawFindings;
    }
  }, [rawFindings, clientFilter]);

  const newsAllegationFindings = useMemo(() => {
    return rawFindings.filter((f) => f.channel_class === "official_news" && (f.is_official_news_allegation || f.allegation_matched));
  }, [rawFindings]);

  return (
    <div className="space-y-6 p-6 font-sans">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Youtube className="h-6 w-6 text-destructive" /> YouTube Removal Intelligence
        </h1>
        <p className="text-sm text-muted-foreground">
          Broad discovery of non-official & official news videos about a protected person, target verification,
          transcript-grounded analysis and removal-candidate prioritisation.
        </p>
      </header>

      {/* Target Search & Source Scope Selector Bar */}
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <Input
          placeholder="Target name (e.g. full name of the protected person)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1"
        />

        {/* Source Scope Selector */}
        <div className="flex items-center gap-2 shrink-0 font-mono text-xs">
          <span className="text-muted-foreground hidden sm:inline">Source Scope:</span>
          <select
            value={sourceScope}
            onChange={(e) => setSourceScope(e.target.value as SourceScope)}
            className="px-3 py-2 rounded-md bg-slate-900 border border-slate-700 text-slate-100 font-bold text-xs cursor-pointer focus:ring-1 focus:ring-indigo-500"
          >
            <option value="NON_OFFICIAL_ONLY">Non-Official Only</option>
            <option value="NEWS_ALLEGATIONS">News / Allegations</option>
            <option value="ALL_SOURCES">All Sources</option>
          </select>
        </div>

        <Button
          onClick={() => start.mutate()}
          disabled={name.trim().length < 2 || start.isPending}
          className="shrink-0 cursor-pointer"
        >
          {start.isPending ? "Scanning…" : "Run targeted scan"}
        </Button>
      </Card>

      {/* Source Scope Active Mode Helper Label */}
      {sourceScope === "NEWS_ALLEGATIONS" && (
        <div className="p-3 rounded-lg bg-indigo-950/40 border border-indigo-800 text-indigo-300 text-xs flex items-center gap-2 font-mono">
          <Info className="w-4 h-4 shrink-0 text-indigo-400" />
          <span>News intelligence mode — official reporting is included for research, allegation tracking, and monitoring.</span>
        </div>
      )}

      {sourceScope === "ALL_SOURCES" && (
        <div className="p-3 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 text-xs flex items-center gap-2 font-mono">
          <Layers className="w-4 h-4 shrink-0 text-slate-400" />
          <span>All Sources mode active — displaying verified independent creators, commentary, and official news streams.</span>
        </div>
      )}

      {/* Scans History Pills */}
      {scans.data && scans.data.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {scans.data.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveScanId(s.id)}
              className={`rounded-md border px-3 py-1.5 text-xs font-mono transition-all cursor-pointer ${
                activeScanId === s.id
                  ? "border-primary bg-primary/10 text-primary font-bold shadow-sm"
                  : "border-border text-muted-foreground hover:border-slate-700"
              }`}
            >
              {s.target_name} · {s.status}
            </button>
          ))}
        </div>
      )}

      {/* Active Scan Telemetry Header */}
      {scan && (
        <Card className="space-y-3 p-4 font-sans">
          <div className="flex flex-wrap items-center gap-4 text-sm font-mono">
            <span className="font-medium text-foreground">{scan.target_name}</span>
            <Badge variant="outline">{scan.status}</Badge>
            <span className="text-muted-foreground">Scope: <strong>{sourceScope}</strong></span>
            <span className="text-muted-foreground">Discovered: {scan.discovered_count}</span>
            <span className="text-muted-foreground">Verified: {scan.verified_count}</span>
            <span className="text-muted-foreground">News Excluded: {scan.excluded_news_count}</span>
            <span className="text-muted-foreground">Actionable: {scan.actionable_count}</span>
          </div>

          {/* Telemetry Summary Bar */}
          {telemetry && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 pt-2 border-t border-border text-xs font-mono">
              <div className="p-2 rounded bg-slate-900 border border-slate-800 text-center">
                <div className="text-slate-500 text-[10px]">News Discovered</div>
                <div className="text-sm font-bold text-slate-200">{telemetry.official_news_discovered}</div>
              </div>
              <div className="p-2 rounded bg-slate-900 border border-slate-800 text-center">
                <div className="text-slate-500 text-[10px]">News Verified</div>
                <div className="text-sm font-bold text-emerald-400">{telemetry.official_news_target_verified}</div>
              </div>
              <div className="p-2 rounded bg-slate-900 border border-slate-800 text-center">
                <div className="text-slate-500 text-[10px]">Allegations Matched</div>
                <div className="text-sm font-bold text-amber-400">{telemetry.official_news_allegation_matched}</div>
              </div>
              <div className="p-2 rounded bg-slate-900 border border-slate-800 text-center">
                <div className="text-slate-500 text-[10px]">News Displayed</div>
                <div className="text-sm font-bold text-indigo-300">{telemetry.official_news_displayed}</div>
              </div>
              <div className="p-2 rounded bg-slate-900 border border-slate-800 text-center">
                <div className="text-slate-500 text-[10px]">Independent Verified</div>
                <div className="text-sm font-bold text-emerald-400">{telemetry.independent_verified}</div>
              </div>
              <div className="p-2 rounded bg-slate-900 border border-slate-800 text-center">
                <div className="text-slate-500 text-[10px]">Total All Sources</div>
                <div className="text-sm font-bold text-cyan-400">{telemetry.total_verified_all_sources}</div>
              </div>
            </div>
          )}

          {scan.status === "running" && (
            <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${scan.progress}%` }} />
            </div>
          )}
        </Card>
      )}

      {/* Client Filter Tabs */}
      {rawFindings.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs font-mono font-medium">
          {[
            { id: "all", label: "All Verified", count: rawFindings.length },
            { id: "independent", label: "Independent", count: rawFindings.filter((f) => f.channel_class !== "official_news").length },
            { id: "news", label: "Official News", count: rawFindings.filter((f) => f.channel_class === "official_news").length },
            { id: "allegations", label: "Allegations", count: rawFindings.filter((f) => f.allegation_matched || (f.news_topic_tags && f.news_topic_tags.length > 0)).length },
            { id: "investigations", label: "Investigations", count: rawFindings.filter((f) => f.news_topic_tags?.includes("INVESTIGATION")).length },
            { id: "scam_fraud", label: "Scam / Fraud", count: rawFindings.filter((f) => f.news_topic_tags?.includes("SCAM_ALLEGATION") || f.news_topic_tags?.includes("FRAUD_ALLEGATION")).length },
            { id: "legal", label: "Legal Cases", count: rawFindings.filter((f) => f.news_topic_tags?.includes("LEGAL_CASE") || f.recommended_action?.includes("LEGAL")).length },
            { id: "actionable", label: "Action Required", count: rawFindings.filter((f) => f.removal_potential === "high" || f.removal_potential === "medium").length },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setClientFilter(t.id)}
              className={`px-3 py-1.5 rounded-lg border transition-all shrink-0 cursor-pointer flex items-center gap-1.5 ${
                clientFilter === t.id
                  ? "bg-slate-800 text-slate-100 font-bold border-slate-600 shadow-sm"
                  : "bg-card text-muted-foreground border-border hover:border-slate-700 hover:text-foreground"
              }`}
            >
              <span>{t.label}</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-black/20 font-mono">{t.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Separate Section: News Allegation Intelligence */}
      {(sourceScope === "NEWS_ALLEGATIONS" || sourceScope === "ALL_SOURCES") && newsAllegationFindings.length > 0 && (
        <div className="rounded-xl border border-indigo-500/30 bg-slate-950 p-5 space-y-4 font-sans">
          <div className="flex items-center justify-between border-b border-indigo-900 pb-3">
            <h3 className="text-sm font-bold text-indigo-300 flex items-center gap-2">
              <Newspaper className="w-4 h-4 text-indigo-400" /> News Allegation Intelligence ({newsAllegationFindings.length})
            </h3>
            <span className="text-[11px] text-slate-400 font-mono">
              Official Reporting & Investigation Monitoring
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {newsAllegationFindings.map((f) => (
              <div key={f.id} className="p-3.5 rounded-lg bg-slate-900 border border-slate-800 space-y-2 font-sans">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 font-bold font-mono border border-indigo-800">
                    Official News
                  </span>
                  <span className="px-2 py-0.5 rounded bg-amber-950 text-amber-300 font-mono">
                    Allegation Coverage
                  </span>
                </div>

                <h4 className="text-xs font-bold text-slate-100 line-clamp-2">
                  <a href={f.video_url} target="_blank" rel="noreferrer" className="hover:text-indigo-400">
                    {f.title}
                  </a>
                </h4>

                <div className="text-[11px] text-slate-400 font-mono flex items-center justify-between">
                  <span>{f.channel_title}</span>
                  <span>{formatNumber(f.view_count ?? null)} views</span>
                </div>

                {/* Neutral Safety Wording */}
                <div className="p-2 rounded bg-slate-950 text-[11px] text-slate-300 border border-slate-800">
                  {formatNewsSafetyNote((f.news_topic_tags || []) as any)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {scan?.status === "completed" && filteredFindings.length === 0 && (
        <Card className="p-6 text-sm text-muted-foreground">
          No verified videos matching current filters were found in this scan.
        </Card>
      )}

      {/* Main Results Cards List */}
      <div className="space-y-3">
        {filteredFindings.map((f) => {
          const isOpen = expanded === f.id;
          const isOfficial = f.channel_class === "official_news";
          const actionable = !isOfficial && (f.removal_potential === "high" || f.removal_potential === "medium");

          return (
            <Card key={f.id} className="p-4 font-sans">
              <div className="flex flex-col gap-3 sm:flex-row">
                <img
                  src={f.thumbnail_url ?? ""}
                  alt={`Thumbnail for ${f.title}`}
                  loading="lazy"
                  className="h-20 w-36 shrink-0 rounded object-cover bg-slate-900"
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
                    <Badge variant="outline" className={isOfficial ? "bg-indigo-950 text-indigo-300 border-indigo-800 font-bold" : ""}>
                      {isOfficial ? "Official News" : f.source_type || "Independent Creator"}
                    </Badge>
                    {(f.is_official_news_allegation || f.allegation_matched) && (
                      <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30">
                        Allegation / Investigation Coverage
                      </Badge>
                    )}
                    <Badge className={removalTone[f.removal_potential] ?? removalTone.low}>
                      Removal: {f.removal_potential.replace("_", " ")}
                    </Badge>
                    <Badge variant="outline">Priority {f.priority_score}</Badge>
                  </div>

                  <p className="truncate text-sm font-medium text-foreground">{f.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {f.channel_title} · {f.published_at ? new Date(f.published_at).toLocaleDateString() : "—"} ·{" "}
                    {formatNumber(f.view_count ?? null)} views · {formatNumber(f.comment_count ?? null)} comments
                  </p>

                  {/* News Topic Tags */}
                  {f.news_topic_tags && f.news_topic_tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1 font-mono text-[10px]">
                      {f.news_topic_tags.map((tag: string) => (
                        <span key={tag} className="px-2 py-0.5 rounded bg-slate-800 text-indigo-300 border border-slate-700">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 flex-col gap-2">
                  <Button size="sm" variant="outline" asChild>
                    <a href={f.video_url} target="_blank" rel="noreferrer">
                      <ExternalLink className="mr-1 h-3 w-3" /> Open
                    </a>
                  </Button>

                  {/* Button Rule: Official news does not expose Start Takedown automatically */}
                  {isOfficial ? (
                    f.recommended_action?.includes("LEGAL") ? (
                      <Button size="sm" variant="outline" onClick={() => setExpanded(isOpen ? null : f.id)}>
                        <ShieldAlert className="mr-1 h-3 w-3 text-amber-400" /> Send for Legal Review
                      </Button>
                    ) : (
                      <Button size="sm" variant="secondary" onClick={() => setExpanded(isOpen ? null : f.id)}>
                        <Eye className="mr-1 h-3 w-3" /> Monitor / Review
                      </Button>
                    )
                  ) : actionable ? (
                    <Button size="sm" asChild>
                      <a href={`/enforcement?url=${encodeURIComponent(f.video_url)}`}>
                        <ShieldAlert className="mr-1 h-3 w-3" /> Start takedown
                      </a>
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => setExpanded(isOpen ? null : f.id)}>
                      <Eye className="mr-1 h-3 w-3" /> Monitor / review
                    </Button>
                  )}

                  <Button size="sm" variant="ghost" onClick={() => setExpanded(isOpen ? null : f.id)}>
                    {isOpen ? "Hide detail" : "Detail"}
                  </Button>
                </div>
              </div>

              {isOpen && (
                <div className="mt-3 space-y-2 border-t border-border pt-3 text-xs font-sans">
                  {isOfficial && (
                    <div className="p-2.5 rounded bg-slate-900 border border-slate-800 text-slate-300 text-xs font-mono">
                      {formatNewsSafetyNote((f.news_topic_tags || []) as any)}
                    </div>
                  )}

                  <p>
                    <span className="text-muted-foreground">Target verification: </span>
                    {f.subject_status} ({f.subject_confidence}%) — {f.verification_reason}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Assessment: </span>
                    {f.assessment_reason}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Recommended route: </span>
                    {f.recommended_route} — {f.recommended_action}
                  </p>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
