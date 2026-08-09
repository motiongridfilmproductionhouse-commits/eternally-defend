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
  Newspaper,
  Info,
  Layers,
  ChevronDown,
  ChevronUp,
  Loader2,
  CheckCircle2,
  Wrench,
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
          "Discover, verify and assess non-official & official news YouTube videos about a protected person using the official YouTube Data API.",
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
  medium: "bg-amber-500/15 text-amber-600 border-amber-500/40",
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
  const [showHistory, setShowHistory] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
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
      q.state.data?.scan?.status === "running" || q.state.data?.scan?.status === "queued" ? 3000 : false,
  });

  const start = useMutation({
    mutationFn: async () => {
      setScanError(null);
      return startFn({ data: { targetName: name.trim(), sourceScope } });
    },
    onSuccess: (res) => {
      setActiveScanId(res.scanId);
      void queryClient.invalidateQueries({ queryKey: ["yt-removal", "scans"] });
    },
    onError: (err: any) => {
      console.error("[YT-SCAN-UI-ERROR]", err);
      setScanError(err?.message || "Unable to start YouTube removal scan. Please try again.");
    },
  });

  const retry = useMutation({
    mutationFn: async (scanId: string) => retryFn({ data: { scanId } }),
    onSuccess: () => void scanDetail.refetch(),
  });

  const scan = scanDetail.data?.scan;
  const rawFindings: FindingItem[] = (scanDetail.data?.findings as any) ?? [];
  const telemetry = scanDetail.data?.telemetry;

  const isScanning = scan?.status === "running" || scan?.status === "queued" || start.isPending;

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
    <div className="space-y-6 p-6 font-sans max-w-7xl mx-auto">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
          <Youtube className="h-6 w-6 text-red-600" /> YouTube Removal Intelligence
        </h1>
        <p className="text-sm text-slate-600">
          Targeted discovery & entity verification using the official YouTube Data API.
        </p>
      </header>

      {/* Target Search & Source Scope Selector Bar (Pure White Eterna Theme) */}
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center bg-white border border-slate-200 shadow-sm">
        <Input
          placeholder="Target name (e.g. full name of the protected person)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 bg-white border-slate-300 text-slate-900 placeholder:text-slate-400"
        />

        {/* Source Scope Selector */}
        <div className="flex items-center gap-2 shrink-0 font-mono text-xs">
          <span className="text-slate-600 font-medium hidden sm:inline">Source Scope:</span>
          <select
            value={sourceScope}
            onChange={(e) => setSourceScope(e.target.value as SourceScope)}
            className="px-3 py-2 rounded-md bg-slate-50 border border-slate-300 text-slate-900 font-bold text-xs cursor-pointer focus:ring-2 focus:ring-blue-500"
          >
            <option value="NON_OFFICIAL_ONLY">Non-Official Only</option>
            <option value="NEWS_ALLEGATIONS">News / Allegations</option>
            <option value="ALL_SOURCES">All Sources</option>
          </select>
        </div>

        <Button
          onClick={() => start.mutate()}
          disabled={name.trim().length < 2 || isScanning}
          className="shrink-0 cursor-pointer font-bold"
          variant={scanError ? "destructive" : scan?.status === "completed" ? "outline" : "default"}
        >
          {isScanning ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Scanning YouTube…
            </>
          ) : scanError ? (
            "Retry Start"
          ) : scan?.status === "completed" ? (
            "Run again"
          ) : (
            "Run targeted scan"
          )}
        </Button>
      </Card>

      {/* UI Error Alert Banner */}
      {scanError && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 font-mono">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
          <span>Unable to start YouTube scan: {scanError}</span>
        </div>
      )}

      {/* Source Scope Helper Messages */}
      {sourceScope === "NEWS_ALLEGATIONS" && (
        <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-xs flex items-center gap-2 font-mono">
          <Info className="w-4 h-4 shrink-0 text-blue-600" />
          <span>News intelligence mode — official reporting is included for research, allegation tracking, and monitoring.</span>
        </div>
      )}

      {sourceScope === "ALL_SOURCES" && (
        <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 text-xs flex items-center gap-2 font-mono">
          <Layers className="w-4 h-4 shrink-0 text-slate-500" />
          <span>All Sources includes verified YouTube creators, commentary, interviews, and official news channels.</span>
        </div>
      )}

      {/* Collapsible Clean Scan History */}
      {scans.data && scans.data.length > 0 && (
        <div className="space-y-2">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="text-xs font-mono text-slate-600 flex items-center gap-1 hover:text-slate-900 cursor-pointer"
          >
            <span>Previous Scans ({scans.data.length})</span>
            {showHistory ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>

          {showHistory && (
            <div className="flex flex-wrap gap-2 pt-1">
              {scans.data.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setActiveScanId(s.id)}
                  className={`rounded-md border px-3 py-1.5 text-xs font-mono transition-all cursor-pointer ${
                    activeScanId === s.id
                      ? "border-blue-600 bg-blue-50 text-blue-700 font-bold shadow-sm"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-400"
                  }`}
                >
                  {s.target_name} · {s.status}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Active Scan Header & Eterna White Telemetry Bar */}
      {scan && (
        <Card className="space-y-3 p-4 bg-white border border-slate-200 shadow-sm font-sans">
          <div className="flex flex-wrap items-center gap-4 text-sm font-mono">
            <span className="font-bold text-slate-900">{scan.target_name}</span>
            <Badge variant="outline" className={scan.status === "completed" ? "bg-emerald-50 text-emerald-700 border-emerald-300" : ""}>
              {scan.status}
            </Badge>
            <span className="text-slate-600">Scope: <strong>{sourceScope}</strong></span>
            <span className="text-slate-600">Discovered: {scan.discovered_count}</span>
            <span className="text-slate-600">Verified: {scan.verified_count}</span>
            <span className="text-slate-600">News Excluded: {scan.excluded_news_count}</span>
            <span className="text-slate-600">Actionable: {scan.actionable_count}</span>
          </div>

          {/* Telemetry Summary Cards */}
          {telemetry && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 pt-2 border-t border-slate-200 text-xs font-mono">
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-center">
                <div className="text-slate-500 text-[10px]">News Discovered</div>
                <div className="text-sm font-bold text-slate-900">{telemetry.official_news_discovered}</div>
              </div>
              <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-center">
                <div className="text-emerald-700 text-[10px]">News Verified</div>
                <div className="text-sm font-bold text-emerald-800">{telemetry.official_news_target_verified}</div>
              </div>
              <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-center">
                <div className="text-amber-700 text-[10px]">Allegations Matched</div>
                <div className="text-sm font-bold text-amber-800">{telemetry.official_news_allegation_matched}</div>
              </div>
              <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-200 text-center">
                <div className="text-blue-700 text-[10px]">News Displayed</div>
                <div className="text-sm font-bold text-blue-800">{telemetry.official_news_displayed}</div>
              </div>
              <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-center">
                <div className="text-emerald-700 text-[10px]">Independent Verified</div>
                <div className="text-sm font-bold text-emerald-800">{telemetry.independent_verified}</div>
              </div>
              <div className="p-2.5 rounded-lg bg-cyan-50 border border-cyan-200 text-center">
                <div className="text-cyan-700 text-[10px]">Total All Sources</div>
                <div className="text-sm font-bold text-cyan-800">{telemetry.total_verified_all_sources}</div>
              </div>
            </div>
          )}

          {scan.status === "running" && (
            <div className="h-2 w-full overflow-hidden rounded bg-slate-100">
              <div className="h-full bg-blue-600 transition-all duration-300" style={{ width: `${scan.progress}%` }} />
            </div>
          )}

          {/* Failed Scan Error Explanation Banner */}
          {scan.status === "failed" && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-lg border border-red-200 bg-red-50 text-xs font-mono text-red-800">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
                <span>
                  {scan.failure_code === "YOUTUBE_QUOTA_EXCEEDED"
                    ? "YouTube API quota limit reached. Scan could not continue."
                    : scan.error_message || "Scan interrupted during verification. Discovered videos could not be fully analyzed."}
                </span>
              </div>
              <Button size="sm" variant="outline" onClick={() => retry.mutate(scan.id)} disabled={retry.isPending} className="bg-white border-red-300 text-red-700 hover:bg-red-100 shrink-0">
                <RefreshCw className="mr-1 h-3 w-3" /> Retry scan
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* Admin Diagnostics Panel (?diag=1) */}
      {isDiagMode && scan && (
        <Card className="p-4 bg-slate-900 text-white font-mono text-xs space-y-3">
          <div className="flex items-center justify-between text-indigo-300 font-bold border-b border-slate-800 pb-2">
            <span className="flex items-center gap-2">
              <Wrench className="w-4 h-4 text-indigo-400" /> Live Admin Diagnostics (?diag=1)
            </span>
            <span className="text-[11px] text-slate-400">Scan ID: {scan.id}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-slate-300">
            <div>Status: <strong>{scan.status}</strong></div>
            <div>Stage: <strong>{scan.stage}</strong></div>
            <div>Failed Stage: <strong>{scan.failed_stage || "none"}</strong></div>
            <div>Failure Code: <strong>{scan.failure_code || "none"}</strong></div>
          </div>
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
                  ? "bg-slate-900 text-white font-bold border-slate-900 shadow-sm"
                  : "bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:text-slate-900"
              }`}
            >
              <span>{t.label}</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-700 font-mono">{t.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Separate Section: News Allegation Intelligence */}
      {(sourceScope === "NEWS_ALLEGATIONS" || sourceScope === "ALL_SOURCES") && newsAllegationFindings.length > 0 && (
        <Card className="p-5 bg-white border border-blue-200 shadow-sm space-y-4 font-sans">
          <div className="flex items-center justify-between border-b border-blue-100 pb-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Newspaper className="w-4 h-4 text-blue-600" /> News Allegation Intelligence ({newsAllegationFindings.length})
            </h3>
            <span className="text-[11px] text-slate-500 font-mono">
              Official Reporting & Investigation Monitoring
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {newsAllegationFindings.map((f) => (
              <div key={f.id} className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2 font-sans">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800 font-bold font-mono border border-blue-200">
                    Official News
                  </span>
                  <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-mono border border-amber-200">
                    Allegation Coverage
                  </span>
                </div>

                <h4 className="text-xs font-bold text-slate-900 line-clamp-2">
                  <a href={f.video_url} target="_blank" rel="noreferrer" className="hover:text-blue-600">
                    {f.title}
                  </a>
                </h4>

                <div className="text-[11px] text-slate-600 font-mono flex items-center justify-between">
                  <span>{f.channel_title}</span>
                  <span>{formatNumber(f.view_count ?? null)} views</span>
                </div>

                {/* Neutral Safety Wording */}
                <div className="p-2 rounded bg-white text-[11px] text-slate-700 border border-slate-200 font-sans">
                  {formatNewsSafetyNote((f.news_topic_tags || []) as any)}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {scan?.status === "completed" && filteredFindings.length === 0 && (
        <Card className="p-6 text-sm text-slate-600 bg-white border border-slate-200">
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
            <Card key={f.id} className="p-4 bg-white border border-slate-200 shadow-sm font-sans">
              <div className="flex flex-col gap-3 sm:flex-row">
                <img
                  src={f.thumbnail_url ?? ""}
                  alt={`Thumbnail for ${f.title}`}
                  loading="lazy"
                  className="h-20 w-36 shrink-0 rounded object-cover bg-slate-100"
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
                    <Badge variant="outline" className={isOfficial ? "bg-blue-50 text-blue-700 border-blue-300 font-bold" : "bg-slate-50 text-slate-700 border-slate-300"}>
                      {isOfficial ? "Official News" : f.source_type || "Independent Creator"}
                    </Badge>
                    {(f.is_official_news_allegation || f.allegation_matched) && (
                      <Badge className="bg-amber-50 text-amber-800 border-amber-300 font-bold">
                        Allegation / Investigation Coverage
                      </Badge>
                    )}
                    <Badge className={removalTone[f.removal_potential] ?? removalTone.low}>
                      Removal: {f.removal_potential.replace("_", " ")}
                    </Badge>
                    <Badge variant="outline">Priority {f.priority_score}</Badge>
                  </div>

                  <p className="truncate text-sm font-medium text-slate-900">{f.title}</p>
                  <p className="text-xs text-slate-500">
                    {f.channel_title} · {f.published_at ? new Date(f.published_at).toLocaleDateString() : "—"} ·{" "}
                    {formatNumber(f.view_count ?? null)} views · {formatNumber(f.comment_count ?? null)} comments
                  </p>

                  {/* News Topic Tags */}
                  {f.news_topic_tags && f.news_topic_tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1 font-mono text-[10px]">
                      {f.news_topic_tags.map((tag: string) => (
                        <span key={tag} className="px-2 py-0.5 rounded bg-slate-100 text-blue-800 border border-slate-200">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 flex-col gap-2">
                  <Button size="sm" variant="outline" asChild className="bg-white border-slate-300">
                    <a href={f.video_url} target="_blank" rel="noreferrer">
                      <ExternalLink className="mr-1 h-3 w-3" /> Open
                    </a>
                  </Button>

                  {/* Button Rule: Official news does not expose Start Takedown automatically */}
                  {isOfficial ? (
                    f.recommended_action?.includes("LEGAL") ? (
                      <Button size="sm" variant="outline" onClick={() => setExpanded(isOpen ? null : f.id)} className="bg-white border-amber-300 text-amber-800">
                        <ShieldAlert className="mr-1 h-3 w-3 text-amber-600" /> Send for Legal Review
                      </Button>
                    ) : (
                      <Button size="sm" variant="secondary" onClick={() => setExpanded(isOpen ? null : f.id)} className="bg-slate-100 text-slate-700">
                        <Eye className="mr-1 h-3 w-3" /> Monitor / Review
                      </Button>
                    )
                  ) : actionable ? (
                    <Button size="sm" asChild className="bg-red-600 hover:bg-red-700 text-white font-bold">
                      <a href={`/enforcement?url=${encodeURIComponent(f.video_url)}`}>
                        <ShieldAlert className="mr-1 h-3 w-3" /> Start takedown
                      </a>
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => setExpanded(isOpen ? null : f.id)} className="bg-slate-100 text-slate-700">
                      <Eye className="mr-1 h-3 w-3" /> Monitor / review
                    </Button>
                  )}

                  <Button size="sm" variant="ghost" onClick={() => setExpanded(isOpen ? null : f.id)} className="text-slate-600">
                    {isOpen ? "Hide detail" : "Detail"}
                  </Button>
                </div>
              </div>

              {isOpen && (
                <div className="mt-3 space-y-2 border-t border-slate-200 pt-3 text-xs font-sans text-slate-700">
                  {isOfficial && (
                    <div className="p-2.5 rounded bg-slate-50 border border-slate-200 text-slate-700 text-xs font-mono">
                      {formatNewsSafetyNote((f.news_topic_tags || []) as any)}
                    </div>
                  )}

                  <p>
                    <span className="text-slate-500">Target verification: </span>
                    {f.subject_status} ({f.subject_confidence}%) — {f.verification_reason}
                  </p>
                  <p>
                    <span className="text-slate-500">Assessment: </span>
                    {f.assessment_reason}
                  </p>
                  <p>
                    <span className="text-slate-500">Recommended route: </span>
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
