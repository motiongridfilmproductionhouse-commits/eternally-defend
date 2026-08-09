import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, ExternalLink, Eye, RefreshCw, ShieldAlert, Youtube, Activity, ShieldCheck, Database, Wrench } from "lucide-react";
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
    queryKey: ["yt-removal", "scan", activeScanId],
    queryFn: () => getFn({ data: { scanId: activeScanId! } }),
    enabled: !!activeScanId,
    refetchInterval: (q) =>
      q.state.data?.scan?.status === "running" || q.state.data?.scan?.status === "queued" ? 4000 : false,
  });

  const start = useMutation({
    mutationFn: async () => startFn({ data: { targetName: name.trim() } }),
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
  const findings = scanDetail.data?.findings ?? [];

  return (
    <div className="space-y-6 p-6 font-sans">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Youtube className="h-6 w-6 text-destructive" /> YouTube Removal Intelligence
        </h1>
        <p className="text-sm text-muted-foreground">
          Broad discovery of non-official YouTube videos about a protected person, target verification,
          transcript-grounded analysis and removal-candidate prioritisation. Removal is never guaranteed.
        </p>
      </header>

      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <Input
          placeholder="Target name (e.g. full name of the protected person)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button
          onClick={() => start.mutate()}
          disabled={name.trim().length < 2 || start.isPending}
          className="shrink-0 cursor-pointer"
        >
          {start.isPending ? "Scanning…" : "Run targeted scan"}
        </Button>
      </Card>

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

      {scan && (
        <Card className="space-y-3 p-4 font-sans">
          <div className="flex flex-wrap items-center gap-4 text-sm font-mono">
            <span className="font-medium text-foreground">{scan.target_name}</span>
            <Badge variant="outline">{scan.status}</Badge>
            <span className="text-muted-foreground">Stage: {scan.stage ?? "—"}</span>
            <span className="text-muted-foreground">Discovered: {scan.discovered_count}</span>
            <span className="text-muted-foreground">Verified: {scan.verified_count}</span>
            <span className="text-muted-foreground">Official news excluded: {scan.excluded_news_count}</span>
            <span className="text-muted-foreground">Actionable: {scan.actionable_count}</span>
            <span className="text-muted-foreground">Queries: {scan.queries?.length ?? 0}</span>
          </div>

          {scan.status === "running" && (
            <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${scan.progress}%` }} />
            </div>
          )}

          {scan.status === "failed" && (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <span>
                Scan incomplete — results unavailable ({scan.failure_code ?? "scan_error"} at{" "}
                {scan.failed_stage ?? "unknown stage"}).
              </span>
              <Button size="sm" variant="outline" onClick={() => retry.mutate(scan.id)} disabled={retry.isPending}>
                <RefreshCw className="mr-1 h-3 w-3" /> Retry
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* Admin Diagnostic Panel (/youtube-removal?diag=1) */}
      {isDiagMode && scan && (
        <div className="rounded-xl border border-indigo-500/40 bg-slate-950 p-4 font-mono text-xs space-y-3 shadow-lg">
          <div className="flex items-center justify-between text-indigo-300 font-bold border-b border-indigo-900 pb-2">
            <span className="flex items-center gap-2">
              <Wrench className="w-4 h-4 text-indigo-400" /> Live Admin Funnel Diagnostics (?diag=1)
            </span>
            <span className="text-[11px] text-slate-400">Commit: 9f4d1df | Engine: 2.3.0</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 text-center">
            <div className="p-2 rounded bg-slate-900 border border-slate-800">
              <div className="text-slate-500 text-[10px]">Discovered</div>
              <div className="text-sm font-bold text-slate-200">{scan.discovered_count}</div>
            </div>
            <div className="p-2 rounded bg-slate-900 border border-slate-800">
              <div className="text-slate-500 text-[10px]">News Excluded</div>
              <div className="text-sm font-bold text-amber-400">{scan.excluded_news_count}</div>
            </div>
            <div className="p-2 rounded bg-slate-900 border border-slate-800">
              <div className="text-slate-500 text-[10px]">Remaining</div>
              <div className="text-sm font-bold text-indigo-300">
                {Math.max(0, scan.discovered_count - scan.excluded_news_count)}
              </div>
            </div>
            <div className="p-2 rounded bg-slate-900 border border-slate-800">
              <div className="text-slate-500 text-[10px]">Attempted</div>
              <div className="text-sm font-bold text-slate-200">
                {scan.verified_count + scan.not_subject_count}
              </div>
            </div>
            <div className="p-2 rounded bg-slate-900 border border-slate-800">
              <div className="text-slate-500 text-[10px]">Verified Target</div>
              <div className="text-sm font-bold text-emerald-400">{scan.verified_count}</div>
            </div>
            <div className="p-2 rounded bg-slate-900 border border-slate-800">
              <div className="text-slate-500 text-[10px]">Not Subject</div>
              <div className="text-sm font-bold text-rose-400">{scan.not_subject_count}</div>
            </div>
          </div>

          <div className="text-[11px] text-slate-400 flex items-center justify-between border-t border-slate-900 pt-2">
            <span>Verifier: <strong>src/lib/firecrawl/entity-verifier.ts (v2.1.0)</strong></span>
            <span>Classifier: <strong>src/lib/firecrawl/removal-classifier.ts (v2.3.0)</strong></span>
          </div>
        </div>
      )}

      {scan?.status === "completed" && findings.length === 0 && (
        <Card className="p-6 text-sm text-muted-foreground">
          No verified non-official videos about this target were found in this scan.
        </Card>
      )}

      <div className="space-y-3">
        {findings.map((f) => {
          const isOpen = expanded === f.id;
          const actionable = f.removal_potential === "high" || f.removal_potential === "medium";
          return (
            <Card key={f.id} className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row">
                <img
                  src={f.thumbnail_url ?? ""}
                  alt={`Thumbnail for ${f.title}`}
                  loading="lazy"
                  className="h-20 w-36 shrink-0 rounded object-cover bg-slate-900"
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">Risk: {f.risk_level}</Badge>
                    <Badge className={removalTone[f.removal_potential] ?? removalTone.low}>
                      Removal: {f.removal_potential.replace("_", " ")}
                    </Badge>
                    <Badge variant="outline">Priority {f.priority_score}</Badge>
                    {f.evidence_verified ? (
                      <Badge variant="outline">Transcript evidence</Badge>
                    ) : (
                      <Badge variant="outline">EVIDENCE_NOT_VERIFIED</Badge>
                    )}
                  </div>
                  <p className="truncate text-sm font-medium text-foreground">{f.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {f.channel_title} · {f.published_at ? new Date(f.published_at).toLocaleDateString() : "—"} ·{" "}
                    {formatNumber(f.view_count)} views · {formatNumber(f.comment_count)} comments
                  </p>
                  <p className="text-xs text-muted-foreground">{f.content_types.join(", ")}</p>
                </div>
                <div className="flex shrink-0 flex-col gap-2">
                  <Button size="sm" variant="outline" asChild>
                    <a href={f.video_url} target="_blank" rel="noreferrer">
                      <ExternalLink className="mr-1 h-3 w-3" /> Open
                    </a>
                  </Button>
                  {actionable ? (
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
                <div className="mt-3 space-y-2 border-t border-border pt-3 text-xs">
                  <p>
                    <span className="text-muted-foreground">Target verification: </span>
                    {f.subject_status} ({f.subject_confidence}%) — {f.verification_reason}
                  </p>
                  {f.problematic_claim && (
                    <p>
                      <span className="text-muted-foreground">Problematic content: </span>
                      {f.problematic_claim}
                    </p>
                  )}
                  {f.potential_violation && (
                    <p>
                      <span className="text-muted-foreground">Potential violation: </span>
                      {f.potential_violation}
                    </p>
                  )}
                  <p>
                    <span className="text-muted-foreground">Assessment: </span>
                    {f.assessment_reason}
                  </p>
                  {f.evidence_needed && (
                    <p>
                      <span className="text-muted-foreground">Evidence needed: </span>
                      {f.evidence_needed}
                    </p>
                  )}
                  <p>
                    <span className="text-muted-foreground">Recommended route: </span>
                    {f.recommended_route} — {f.recommended_action}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Transcript: </span>
                    {f.transcript_state ?? "n/a"} {f.transcript_language ? `(${f.transcript_language})` : ""}
                  </p>
                  {Array.isArray(f.evidence_timestamps) && f.evidence_timestamps.length > 0 && (
                    <ul className="space-y-1">
                      {(f.evidence_timestamps as Array<Record<string, unknown>>).map((e, i) => (
                        <li key={i} className="rounded border border-border p-2 font-mono">
                          <a
                            className="text-primary underline"
                            href={`${f.video_url}&t=${Number(e.seconds ?? 0)}s`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {String(e.timestamp ?? "")}
                          </a>{" "}
                          <span className="text-muted-foreground">[{String(e.violationType ?? "")}]</span>{" "}
                          {String(e.excerpt ?? "")}
                        </li>
                      ))}
                    </ul>
                  )}
                  {f.discovery_queries.length > 0 && (
                    <p className="text-muted-foreground">Found via: {f.discovery_queries.join(" · ")}</p>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
