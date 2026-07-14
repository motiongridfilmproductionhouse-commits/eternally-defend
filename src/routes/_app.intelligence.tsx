import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  startMultimediaAnalysis, getMultimediaJob, listMultimediaJobs,
  updateFindingReview, getProviderStatus, fetchYoutubeMetadataFn,
} from "@/lib/mm/mm.functions";
import { importCaptions } from "@/lib/mm/uploads.functions";
import { PageCard, StatCard } from "@/components/dashboard/PageCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ReviewWorkspace, ReviewStatusBadge } from "@/components/mm/ReviewWorkspace";
import { ScoreExplainer } from "@/components/mm/ScoreExplainer";
import { useUserRoles } from "@/hooks/use-user-roles";
import {
  Activity, AlertTriangle, CheckCircle2, Clock, ExternalLink, FileVideo,
  Flag, Languages, PlayCircle, Search, ShieldAlert, Sparkles, XCircle,
} from "lucide-react";

export const Route = createFileRoute("/_app/intelligence")({
  head: () => ({ meta: [{ title: "Evidence Analysis Center — Eterna AI" }] }),
  component: IntelligenceEnginePage,
});

const STAGE_LABELS: Record<string, string> = {
  prepare: "Preparing evidence",
  upload: "Ingesting authorized content",
  video_intelligence: "Visual scene analysis",
  audio_extract: "Extracting audio track",
  transcription: "Reconstructing transcript",
  mention_detect: "Detecting exact mentions",
  vision_frames: "Analyzing visual frames",
  translation: "Translating content",
  claim_extract: "Extracting claims",
  fact_check: "Cross-checking public record",
  risk_score: "Calculating threat scores",
  save_evidence: "Preserving evidence",
  threat_radar: "Escalating to Threat Radar",
  finalize: "Compiling report",
};

function useSession() {
  const [session, setSession] = useState<any>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const sub = supabase.auth.onAuthStateChange((_, s) => setSession(s)).data.subscription;
    return () => sub.unsubscribe();
  }, []);
  return { session, ready };
}

function IntelligenceEnginePage() {
  const { session, ready } = useSession();
  if (!ready) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  if (!session) {
    return (
      <PageCard title="EVIDENCE ANALYSIS CENTER" sub="Sign in to run analyses and view saved evidence">
        <div className="py-10 text-center">
          <ShieldAlert className="size-10 mx-auto text-muted-foreground" />
          <p className="mt-3 text-sm">Analyses are private to your account. Sign in to continue.</p>
          <Link to="/auth" className="inline-block mt-4">
            <Button>Sign in</Button>
          </Link>
        </div>
      </PageCard>
    );
  }
  return <SignedInEngine />;
}

function SignedInEngine() {
  const qc = useQueryClient();
  const startFn = useServerFn(startMultimediaAnalysis);
  const providerFn = useServerFn(getProviderStatus);
  const listFn = useServerFn(listMultimediaJobs);

  const providers = useQuery({ queryKey: ["mm-providers"], queryFn: () => providerFn() });
  const jobs = useQuery({ queryKey: ["mm-jobs"], queryFn: () => listFn() });

  const [source, setSource] = useState<"youtube" | "url" | "text">("youtube");
  const [ytUrl, setYtUrl] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [targetName, setTargetName] = useState("");
  const [aliases, setAliases] = useState("");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const ytMetaFn = useServerFn(fetchYoutubeMetadataFn);

  const start = useMutation({
    mutationFn: async () => {
      const target_aliases = aliases.split(",").map((s) => s.trim()).filter(Boolean);
      if (source === "youtube") {
        const vid = extractYoutubeId(ytUrl);
        if (!vid) throw new Error("Please paste a valid YouTube URL");
        const meta = await ytMetaFn({ data: { url: ytUrl } });
        const md = meta.ok ? meta.metadata : { video_id: vid, title: "YouTube video", thumbnail: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` };
        return startFn({
          data: {
            source_kind: "youtube_meta",
            source_ref: `https://youtu.be/${vid}`,
            source_metadata: {
              video_id: vid,
              title: md.title,
              channel: (md as any).channel ?? undefined,
              description: (md as any).description ?? undefined,
              thumbnail: md.thumbnail,
              duration_seconds: (md as any).duration_seconds ?? undefined,
              view_count: (md as any).view_count ?? undefined,
            },
            target_name: targetName, target_aliases,
          },
        });
      }
      if (source === "url") {
        return startFn({
          data: {
            source_kind: "url", source_ref: pageUrl,
            source_metadata: { title: pageUrl },
            target_name: targetName, target_aliases,
          },
        });
      }
      return startFn({
        data: {
          source_kind: "screenshot", source_ref: `text:${Date.now()}`,
          source_metadata: { title: "Pasted content", description: pastedText.slice(0, 4000) },
          target_name: targetName, target_aliases,
        },
      });
    },
    onSuccess: (res) => {
      setActiveJobId(res.jobId);
      qc.invalidateQueries({ queryKey: ["mm-jobs"] });
    },
  });

  const canRun = targetName.trim().length > 1 && (
    (source === "youtube" && ytUrl.trim()) ||
    (source === "url" && pageUrl.trim()) ||
    (source === "text" && pastedText.trim().length > 20)
  );

  return (
    <div className="space-y-5">
      <ProviderStatusBar providers={providers.data} />

      <PageCard title="RUN NEW ANALYSIS" sub="Analyze YouTube videos, URLs, or pasted content">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
          <div className="space-y-4">
            <div className="flex gap-2 text-xs">
              {(["youtube", "url", "text"] as const).map((t) => (
                <button key={t} onClick={() => setSource(t)}
                  className={`px-3 py-1.5 rounded-lg border ${source === t ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}>
                  {t === "youtube" ? "YouTube video" : t === "url" ? "Web URL" : "Paste text"}
                </button>
              ))}
            </div>
            {source === "youtube" && (
              <Input placeholder="https://www.youtube.com/watch?v=..." value={ytUrl} onChange={(e) => setYtUrl(e.target.value)} />
            )}
            {source === "url" && (
              <Input placeholder="https://example.com/article" value={pageUrl} onChange={(e) => setPageUrl(e.target.value)} />
            )}
            {source === "text" && (
              <Textarea rows={6} placeholder="Paste an article, transcript, or comment thread…" value={pastedText} onChange={(e) => setPastedText(e.target.value)} />
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input placeholder="Protected name / brand (required)" value={targetName} onChange={(e) => setTargetName(e.target.value)} />
              <Input placeholder="Aliases (comma-separated)" value={aliases} onChange={(e) => setAliases(e.target.value)} />
            </div>
            {start.error && <div className="text-xs text-destructive">{(start.error as Error).message}</div>}
            <div className="flex gap-2">
              <Button disabled={!canRun || start.isPending} onClick={() => start.mutate()}>
                <Sparkles className="size-4 mr-2" />{start.isPending ? "Running analysis…" : "Run Intelligence Analysis"}
              </Button>
            </div>
          </div>
          <div className="bg-muted/30 border border-border rounded-xl p-4 text-xs space-y-2">
            <div className="font-semibold text-sm mb-1">What runs automatically</div>
            <StageAvailabilityList providers={providers.data} />
          </div>
        </div>
      </PageCard>

      {activeJobId && <JobDetail jobId={activeJobId} onClose={() => setActiveJobId(null)} />}
      {activeJobId && (
        <CaptionImportPanel jobId={activeJobId} targetName={targetName} aliases={aliases} onImported={() => qc.invalidateQueries({ queryKey: ["mm-job", activeJobId] })} />
      )}

      <PageCard title="RECENT ANALYSES" sub="Your saved intelligence reports">
        {jobs.isLoading ? <div className="text-sm text-muted-foreground">Loading…</div> : (
          <div className="space-y-2">
            {(jobs.data?.jobs ?? []).map((j: any) => (
              <button key={j.id} onClick={() => setActiveJobId(j.id)}
                className={`w-full text-left border rounded-xl p-3 hover:bg-accent transition-colors ${activeJobId === j.id ? "border-primary bg-accent/50" : "border-border"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{j.target_name} · {j.source_kind}</div>
                    <div className="text-xs text-muted-foreground truncate">{j.source_ref}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusPill status={j.status} />
                    {j.reputation_score !== null && <Badge variant="outline" className="text-xs">Rep {Math.round(j.reputation_score)}</Badge>}
                  </div>
                </div>
              </button>
            ))}
            {!jobs.data?.jobs?.length && <div className="text-sm text-muted-foreground py-6 text-center">No analyses yet — run one above.</div>}
          </div>
        )}
      </PageCard>
    </div>
  );
}

function ProviderStatusBar({ providers }: { providers?: any }) {
  if (!providers) return null;
  const items = [
    { k: "Fact Check", v: providers.hasFactCheckKey ? "live" : "off" },
    { k: "Translation", v: providers.hasTranslationKey ? "live" : "off" },
    { k: "Video Intelligence", v: providers.videoIntelligence === "stub" ? "credentials needed" : "live" },
    { k: "Speech-to-Text", v: providers.speechToText === "stub" ? "credentials needed" : "live" },
    { k: "Vision", v: providers.vision === "stub" ? "credentials needed" : "live" },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {items.map((i) => (
        <StatCard key={i.k} label={i.k.toUpperCase()} value={i.v === "live" ? "Live" : i.v === "off" ? "Off" : "Stub"}
          sub={i.v === "live" ? "API responding" : i.v === "off" ? "Key not configured" : "Service account required"}
          accent={i.v === "live" ? "oklch(0.68 0.16 155)" : "oklch(0.75 0.16 70)"} />
      ))}
    </div>
  );
}

function StageAvailabilityList({ providers }: { providers?: any }) {
  if (!providers) return null;
  const rows = [
    ["Mention detection", true, "Runs on title/description/text"],
    ["Translation", providers.hasTranslationKey, "Google Translate v2"],
    ["Claim extraction", true, "Gemini via Lovable AI Gateway"],
    ["Fact Check Tools", providers.hasFactCheckKey, "Publisher review lookup"],
    ["Video Intelligence", !providers.videoIntelligence.includes("stub"), "Scene/object/logo/OCR — needs SA"],
    ["Speech-to-Text", !providers.speechToText.includes("stub"), "Word-timestamped transcript — needs SA"],
    ["Vision (frames)", !providers.vision.includes("stub"), "Logo/OCR/safe-search — needs SA"],
  ] as const;
  return (
    <ul className="space-y-1.5">
      {rows.map(([label, on, sub]) => (
        <li key={label} className="flex items-start gap-2">
          {on ? <CheckCircle2 className="size-3.5 text-emerald-500 mt-0.5" /> : <XCircle className="size-3.5 text-muted-foreground mt-0.5" />}
          <div>
            <div className="text-xs">{label}</div>
            <div className="text-[10px] text-muted-foreground">{sub}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone: Record<string, string> = {
    running: "bg-blue-500/10 text-blue-600",
    completed: "bg-emerald-500/10 text-emerald-600",
    partial: "bg-amber-500/10 text-amber-600",
    failed: "bg-red-500/10 text-red-600",
    pending: "bg-muted text-muted-foreground",
  };
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${tone[status] ?? tone.pending}`}>{status}</span>;
}

function JobDetail({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const getFn = useServerFn(getMultimediaJob);
  const q = useQuery({
    queryKey: ["mm-job", jobId],
    queryFn: () => getFn({ data: { jobId } }),
    refetchInterval: (query) => {
      const s = (query.state.data as any)?.job?.status;
      return s === "running" || s === "pending" ? 1500 : false;
    },
  });
  const [tab, setTab] = useState<"overview" | "timeline" | "facts" | "translations" | "technical">("overview");

  if (q.isLoading) return <PageCard title="ANALYSIS"><div className="text-sm text-muted-foreground">Loading…</div></PageCard>;
  const d: any = q.data;
  if (!d?.job) return null;
  const job = d.job;
  const stages = job.stage_status ?? {};

  return (
    <PageCard title={`ANALYSIS · ${job.target_name}`} sub={job.source_ref}
      actions={<button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">Close</button>}>
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
        <div>
          <div className="mb-3">
            <div className="text-xs text-muted-foreground mb-1">Progress</div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${job.progress_percent}%` }} />
            </div>
            <div className="text-[11px] text-muted-foreground mt-1">{job.progress_message ?? job.status}</div>
          </div>
          <ol className="space-y-1 text-xs">
            {Object.keys(STAGE_LABELS).map((s) => (
              <StageRow key={s} name={STAGE_LABELS[s]} status={stages[s] ?? "pending"} />
            ))}
          </ol>
        </div>

        <div>
          <div className="flex gap-1 text-xs mb-3 border-b border-border">
            {(["overview", "timeline", "facts", "translations", "technical"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-3 py-2 -mb-px border-b-2 capitalize ${tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                {t === "facts" ? "Fact checks" : t}
                {t === "timeline" && d.findings.length > 0 && ` (${d.findings.length})`}
              </button>
            ))}
          </div>

          {tab === "overview" && <OverviewTab job={job} findings={d.findings} errors={d.errors} />}
          {tab === "timeline" && <TimelineTab findings={d.findings} videoId={job.source_metadata?.video_id} />}
          {tab === "facts" && <FactsTab claims={d.claims} checks={d.checks} />}
          {tab === "translations" && <TranslationsTab translations={d.translations} />}
          {tab === "technical" && <TechnicalTab job={job} errors={d.errors} />}
        </div>
      </div>
    </PageCard>
  );
}

function StageRow({ name, status }: { name: string; status: string }) {
  const icon = {
    done: <CheckCircle2 className="size-3.5 text-emerald-500" />,
    running: <Activity className="size-3.5 text-blue-500 animate-pulse" />,
    failed: <XCircle className="size-3.5 text-red-500" />,
    unavailable: <ShieldAlert className="size-3.5 text-amber-500" />,
    skipped: <Clock className="size-3.5 text-muted-foreground" />,
    empty: <Clock className="size-3.5 text-muted-foreground" />,
    pending: <Clock className="size-3.5 text-muted-foreground" />,
    queued: <Flag className="size-3.5 text-blue-500" />,
  }[status] ?? <Clock className="size-3.5 text-muted-foreground" />;
  return <li className="flex items-center gap-2">{icon}<span className={status === "unavailable" ? "text-amber-600" : ""}>{name}</span></li>;
}

function OverviewTab({ job, findings, errors }: any) {
  const risk = job.risk_scores ?? {};
  const explanations = (job.confidence_by_axis ?? {}) as Record<string, any>;
  const scores = [
    ["Reputation risk", "reputation", risk.reputation],
    ["Defamation", "defamation", risk.defamation],
    ["Copyright", "copyright", risk.copyright],
    ["Misinformation", "misinformation", risk.misinformation],
    ["Harassment", "harassment", risk.harassment],
    ["Impersonation", "impersonation", risk.impersonation],
    ["Viral amplification", "viralAmplification", risk.viralAmplification],
    ["Entity relevance", "entityRelevance", risk.entityRelevance],
    ["Evidence confidence", "evidenceConfidence", risk.evidenceConfidence],
  ] as const;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {scores.map(([k, axis, v]) => (
          <div key={k} className="border border-border rounded-lg p-2.5">
            <div className="text-[10px] uppercase text-muted-foreground flex items-center justify-between gap-1">
              <span>{k}</span>
              <ScoreExplainer axis={axis} label={k} explanation={explanations[axis]} />
            </div>
            <div className="text-lg font-semibold">{v ?? "—"}</div>
          </div>
        ))}
      </div>
      <div className="text-sm">
        <div className="font-medium mb-2">Summary</div>
        <p className="text-muted-foreground">
          {findings.length} timeline finding{findings.length === 1 ? "" : "s"} across metadata and existing fact-check reviews.
          {errors.length > 0 && ` ${errors.length} provider${errors.length === 1 ? "" : "s"} unavailable — see Technical tab.`}
        </p>
      </div>
    </div>
  );
}

function TimelineTab({ findings, videoId }: { findings: any[]; videoId?: string }) {
  const [reviewing, setReviewing] = useState<any | null>(null);
  if (!findings.length) return <div className="text-sm text-muted-foreground py-6 text-center">No timeline findings yet.</div>;
  return (
    <div className="space-y-2">
      {findings.map((f) => (
        <div key={f.id} className="border border-border rounded-xl p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{formatTime(f.start_seconds)}</span>
                <SeverityBadge level={f.severity} />
                <ReviewStatusBadge status={f.human_review_status ?? "unreviewed"} />
                <span className="text-xs text-muted-foreground">{f.finding_type.replace(/_/g, " ")}</span>
              </div>
              <div className="mt-1 font-medium text-sm">{f.title}</div>
              {f.description && <p className="text-xs text-muted-foreground mt-1">{f.description}</p>}
              {f.transcript_excerpt && (
                <blockquote className="mt-2 text-xs border-l-2 border-border pl-2 text-muted-foreground italic">
                  {f.transcript_excerpt.slice(0, 220)}{f.transcript_excerpt.length > 220 && "…"}
                </blockquote>
              )}
              {f.translation && f.original_language && f.original_language !== "en" && (
                <div className="mt-1 text-xs"><Languages className="inline size-3 mr-1" />EN: {f.translation.slice(0, 180)}</div>
              )}
              {f.detection_reason && <div className="text-[10px] text-muted-foreground mt-1">Reason: {f.detection_reason}</div>}
            </div>
            <div className="shrink-0 flex flex-col gap-1.5">
              {(f.youtube_deep_link || videoId) && (
                <a href={f.youtube_deep_link ?? `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(f.start_seconds)}s`}
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-border hover:bg-accent">
                  <PlayCircle className="size-3" />Watch
                </a>
              )}
              <button onClick={() => setReviewing(f)}
                className="text-xs px-2 py-1 rounded border border-border hover:bg-accent">
                Review
              </button>
            </div>
          </div>
        </div>
      ))}
      <ReviewWorkspace finding={reviewing} open={!!reviewing} onClose={() => setReviewing(null)} onSaved={() => setReviewing(null)} />
    </div>
  );
}

function FactsTab({ claims, checks }: { claims: any[]; checks: any[] }) {
  if (!claims.length) return <div className="text-sm text-muted-foreground py-6 text-center">No claims extracted.</div>;
  return (
    <div className="space-y-3">
      {claims.map((c) => {
        const own = checks.filter((k) => k.extracted_claim_id === c.id);
        return (
          <div key={c.id} className="border border-border rounded-xl p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium">{c.extracted_claim}</div>
                <div className="text-xs text-muted-foreground mt-0.5">"{c.original_statement.slice(0, 200)}"</div>
                {c.claimant && <div className="text-[10px] text-muted-foreground mt-0.5">Attributed to: {c.claimant}</div>}
              </div>
              <Badge variant="outline" className="shrink-0 text-[10px]">{c.fact_check_status.replace(/_/g, " ")}</Badge>
            </div>
            {own.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {own.map((r) => (
                  <a key={r.id} href={r.review_url ?? "#"} target="_blank" rel="noopener noreferrer"
                    className="flex items-start gap-2 text-xs p-2 rounded border border-border hover:bg-accent">
                    <ExternalLink className="size-3 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{r.review_title ?? "Fact check review"}</div>
                      <div className="text-muted-foreground">
                        {r.publisher_name ?? "Unknown publisher"} · {r.textual_rating ?? "no rating"}
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TranslationsTab({ translations }: { translations: any[] }) {
  if (!translations.length) return <div className="text-sm text-muted-foreground py-6 text-center">No translations recorded (source already English or translation unavailable).</div>;
  return (
    <div className="space-y-3">
      {translations.map((t) => (
        <div key={t.id} className="border border-border rounded-xl p-3">
          <div className="flex items-center gap-2 text-xs mb-2">
            <Badge variant="outline">{t.detected_language ?? "?"} → {t.target_language}</Badge>
            {t.requires_review && <Badge variant="destructive" className="text-[10px]">Low confidence</Badge>}
            <span className="text-muted-foreground text-[10px]">{t.provider}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            <div><div className="text-[10px] uppercase text-muted-foreground mb-1">Original</div><div>{t.original_text}</div></div>
            <div><div className="text-[10px] uppercase text-muted-foreground mb-1">English</div><div>{t.translated_text}</div></div>
          </div>
        </div>
      ))}
    </div>
  );
}

function TechnicalTab({ job, errors }: any) {
  return (
    <div className="space-y-3 text-xs">
      <div>
        <div className="font-medium text-sm mb-1">Job</div>
        <dl className="grid grid-cols-[140px_1fr] gap-y-1 text-muted-foreground">
          <dt>Job ID</dt><dd className="font-mono text-[11px] break-all">{job.id}</dd>
          <dt>Source kind</dt><dd>{job.source_kind}</dd>
          <dt>Source ref</dt><dd className="break-all">{job.source_ref}</dd>
          <dt>Started</dt><dd>{job.started_at}</dd>
          <dt>Finished</dt><dd>{job.finished_at ?? "—"}</dd>
          <dt>Status</dt><dd>{job.status}</dd>
        </dl>
      </div>
      {errors.length > 0 && (
        <div>
          <div className="font-medium text-sm mb-1 flex items-center gap-1"><AlertTriangle className="size-3.5 text-amber-500" /> Provider errors</div>
          <ul className="space-y-1">
            {errors.map((e: any) => (
              <li key={e.id} className="border border-border rounded p-2">
                <div className="font-medium">{e.stage} · {e.provider}</div>
                <div className="text-muted-foreground">{e.error_message}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SeverityBadge({ level }: { level: string }) {
  const map: Record<string, string> = {
    critical: "bg-red-500/15 text-red-600",
    high: "bg-orange-500/15 text-orange-600",
    medium: "bg-amber-500/15 text-amber-700",
    low: "bg-blue-500/15 text-blue-600",
    info: "bg-muted text-muted-foreground",
  };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded ${map[level] ?? map.info}`}>{level}</span>;
}

function formatTime(sec: number) {
  const s = Math.floor(sec % 60), m = Math.floor((sec / 60) % 60), h = Math.floor(sec / 3600);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

function extractYoutubeId(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1).split(/[/?#]/)[0] || null;
    const v = u.searchParams.get("v");
    if (v) return v;
    const m = u.pathname.match(/\/(shorts|embed|live)\/([^/?#]+)/);
    return m ? m[2] : null;
  } catch { return null; }
}

function CaptionImportPanel({ jobId, targetName, aliases, onImported }: { jobId: string; targetName: string; aliases: string; onImported: () => void }) {
  const importFn = useServerFn(importCaptions);
  const [text, setText] = useState("");
  const [filename, setFilename] = useState("");
  const [source, setSource] = useState<"user_uploaded" | "owner_authorised" | "external" | "manual">("user_uploaded");
  const mut = useMutation({
    mutationFn: async () => importFn({
      data: {
        job_id: jobId, filename: filename || undefined, raw_text: text,
        transcript_source: source,
        target_name: targetName || undefined,
        target_aliases: aliases.split(",").map((s) => s.trim()).filter(Boolean),
      },
    }),
    onSuccess: () => { setText(""); setFilename(""); onImported(); },
  });
  const onFile = async (f: File | null) => {
    if (!f) return;
    setFilename(f.name);
    setText(await f.text());
  };
  return (
    <PageCard title="IMPORT CAPTIONS OR TRANSCRIPT" sub="SRT / VTT produce exact timestamped findings. Plain text is treated as a passage — no synthetic timestamps.">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4">
        <div className="space-y-2">
          <div className="flex gap-2 items-center text-xs">
            <input type="file" accept=".srt,.vtt,.txt" onChange={(e) => onFile(e.target.files?.[0] ?? null)} className="text-xs" />
            {filename && <span className="text-muted-foreground truncate">{filename}</span>}
          </div>
          <Textarea rows={7} placeholder="Or paste SRT / VTT / transcript here…" value={text} onChange={(e) => setText(e.target.value)} />
          {mut.error && <div className="text-xs text-destructive">{(mut.error as Error).message}</div>}
          {mut.data && (
            <div className="text-xs text-emerald-600">
              Imported {(mut.data as any).format.toUpperCase()} · {(mut.data as any).segment_count} segments · {(mut.data as any).findingsCreated} timestamped findings created.
            </div>
          )}
        </div>
        <div className="space-y-2 text-xs">
          <label className="text-[10px] uppercase text-muted-foreground">Transcript source</label>
          <select value={source} onChange={(e) => setSource(e.target.value as any)} className="w-full border border-border rounded px-2 py-1.5 bg-background">
            <option value="user_uploaded">User uploaded</option>
            <option value="owner_authorised">Owner-authorised captions</option>
            <option value="external">External provider</option>
            <option value="manual">Manually entered</option>
          </select>
          <Button size="sm" disabled={!text.trim() || mut.isPending} onClick={() => mut.mutate()} className="w-full">
            {mut.isPending ? "Importing…" : "Import & timestamp"}
          </Button>
          <div className="text-[10px] text-muted-foreground">
            Findings created from captions are marked <code>timestamp_source=captions</code>. Untimestamped text is stored but never given a synthetic time.
          </div>
        </div>
      </div>
    </PageCard>
  );
}

