import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReputationReport, ScanHit, SourceKey, Sentiment, FreshnessWindow } from "@/routes/api/scan";
import { PageCard, Pill } from "@/components/dashboard/PageCard";
import { severityColor } from "@/lib/data-store";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "sonner";
import { persistScan, listScanHits } from "@/lib/scans.functions";
import { analyzeYoutubeVideo } from "@/lib/video-analysis.functions";
import { generateScanReportPdf } from "@/lib/scan-report-pdf.functions";
import { ExactMomentsPanel, ExactMomentsSummaryChips } from "@/components/scan/ExactMomentsPanel";
import { cleanTitle, viaProxy, faviconUrl, hostFromUrl, readableFromSlug, youtubeThumbFromUrl, youtubeIdFromUrl } from "@/lib/media-utils";
import { PersistedResultCard, type HitLike } from "@/components/scan/PersistedResultCard";
import { DetailDrawer } from "@/components/scan/DetailDrawer";
import { ActionDrawer, type ActionTarget } from "@/components/scan/ActionDrawer";
import { listEvidenceStatus, hideScanHit } from "@/lib/scan-actions.functions";
import {
  Radar, Search, ExternalLink, ShieldPlus, Loader2, Sparkles, TrendingUp,
  AlertTriangle, Flame, Users, Eye, Copyright, Gavel, Bell, FileDown,
  Youtube, MessageCircle, Newspaper, Instagram, Facebook, Globe, ShieldAlert,
  BadgeCheck, ScanSearch, Clock, Database, EyeOff, X as XIcon,
} from "lucide-react";


export const Route = createFileRoute("/_app/scan")({
  head: () => ({ meta: [
    { title: "Reputation Intelligence Report — Eterna AI" },
    { name: "description", content: "Evidence-based reputation intelligence across news, social, video, and forums." },
  ] }),
  component: ScanPage,
});

// Ordered by reputation-damage priority: YouTube first, then News, Reddit, social, blogs/forums/reviews/archive.
const SOURCES: { key: SourceKey; label: string }[] = [
  { key: "youtube", label: "YouTube" },
  { key: "news", label: "News" },
  { key: "reddit", label: "Reddit" },
  { key: "x", label: "X" },
  { key: "instagram", label: "Instagram" },
  { key: "tiktok", label: "TikTok" },
  { key: "facebook", label: "Facebook" },
  { key: "blogs", label: "Blogs" },
  { key: "forums", label: "Forums" },
  { key: "reviews", label: "Reviews" },
  { key: "archive", label: "Archive" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "podcasts", label: "Podcasts" },
  { key: "complaints", label: "Complaints" },
  { key: "web", label: "Web" },
];



const DEFAULT_SOURCES: SourceKey[] = ["youtube", "news", "reddit", "x", "instagram", "tiktok", "facebook", "blogs", "forums", "reviews", "archive"];

const sentimentColor = (s: Sentiment) =>
  s === "Negative" ? "oklch(0.63 0.24 25)" : s === "Positive" ? "oklch(0.68 0.16 155)" : "oklch(0.55 0.03 275)";

const scoreColor = (v: number) =>
  v >= 75 ? "oklch(0.68 0.16 155)" : v >= 60 ? "oklch(0.75 0.14 90)" : v >= 40 ? "oklch(0.7 0.18 55)" : v >= 20 ? "oklch(0.65 0.22 35)" : "oklch(0.55 0.24 25)";

function fmt(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

// Extended report type with server-side diagnostics
interface YtDiag {
  queriesRun: number;
  pagesScanned: number;
  videosFound: number;
  apiErrors: number;
  quotaExhausted?: boolean;
  quotaReason?: string | null;
  error: string | null;
  target: number;
  status?: "ok" | "quota_exhausted" | "no_results" | "disabled";
}
interface FcDiscoveryDiag {
  active: boolean;
  queriesExecuted?: number;
  rawUrls?: number;
  relevantUrls?: number;
  uniqueUrls?: number;
  youtubeUrlsDiscovered?: number;
  newsDiscovered?: number;
  socialDiscovered?: number;
  otherWebDiscovered?: number;
  tier1Queries?: number;
  tier2Queries?: number;
  ytWebQueries?: number;
  expandedTermsUsed?: string[];
}
interface ReportWithDiagnostics extends ReputationReport {
  diagnostics?: {
    youtube?: YtDiag;
    firecrawlDiscovery?: FcDiscoveryDiag;
    sourceCounts?: Record<string, number>;
    totalRawFetched?: number;
    sourcesWithResults?: string[];
    scannedAt?: string;
    breakingCount?: number;
    recent3dCount?: number;
    recent7dCount?: number;
  };
}

async function runScan(payload: unknown): Promise<ReportWithDiagnostics> {
  const r = await fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const j = await r.json();
  return j as ReportWithDiagnostics;
}

function ScanPage() {
  const { session } = useSession();
  const userId = session?.user.id;
  const generateReportPdf = useServerFn(generateScanReportPdf);
  const [pdfPending, setPdfPending] = useState(false);
  const [q, setQ] = useState("");
  const [aliases, setAliases] = useState("");
  const [variations, setVariations] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [handles, setHandles] = useState("");
  const [site, setSite] = useState("");
  const [country, setCountry] = useState("");
  const [industry, setIndustry] = useState("");
  const [monthFilter, setMonthFilter] = useState<"24h"|"7d"|"30d"|"12m"|"all">("12m");

  const [sources, setSources] = useState<SourceKey[]>(DEFAULT_SOURCES);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [persistedScanId, setPersistedScanId] = useState<string | null>(null);
  const [persistSummary, setPersistSummary] = useState<{ newHits: number; updatedHits: number; duplicatesRemoved: number; uniqueHits: number } | null>(null);

  const m = useMutation({ mutationFn: runScan });
  const autoScanStarted = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || autoScanStarted.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("auto") !== "1") return;
    const query = (params.get("query") ?? "").trim();
    const assetId = (params.get("assetId") ?? "").trim();
    if (!query || !assetId) return;

    autoScanStarted.current = true;
    setQ(query);
    setSources(DEFAULT_SOURCES);
    setMonthFilter("12m");
    setAdded(new Set());
    m.mutate({
      query,
      aliases: [],
      variations: [],
      hashtags: [],
      handles: [],
      monthFilter: "12m",
      sources: DEFAULT_SOURCES,
      limit: 10,
      youtubeTarget: 300,
      resultCap: 300,
      assetId,
      context: "person; uploaded identity reference",
    });
    window.history.replaceState({}, "", "/scan");
  }, [m]);

  const report = m.data as ReportWithDiagnostics | undefined;
  const persistFn = useServerFn(persistScan);
  const analyzeFn = useServerFn(analyzeYoutubeVideo);
  const [analyzingVideos, setAnalyzingVideos] = useState<Set<string>>(new Set());

  // Persist to DB once the report lands. Runs once per report identity.
  useEffect(() => {
    if (!report || !report.hits.length) return;
    let cancelled = false;
    (async () => {
      try {
        const mapped = report.hits.map((h) => ({
          source: h.source,
          sourceType: h.source === "YouTube" ? "youtube_video" : h.source.toLowerCase(),
          externalId: h.media?.videoId ?? null,
          canonicalUrl: h.url,
          permalink: h.url,
          title: h.title,
          description: h.description,
          author: h.author ?? h.media?.channelTitle ?? null,
          thumbnailUrl: h.media?.thumbnailHi ?? h.media?.thumbnail ?? null,
          language: h.language,
          publishedAt: h.published ?? null,
          reach: h.reachEstimate,
          engagement: h.engagement,
          velocity: h.viral ? "viral" : null,
          riskScore: h.threatScore,
          threatScore: h.threatScore,
          severity: h.severity,
          growthPct: h.media?.growthPerDay ?? null,
          riskType: h.category,
          tags: h.keywords,
          metrics: {
            views: h.media?.views ?? null,
            likes: h.media?.likes ?? null,
            comments: h.media?.comments ?? null,
            growthPerDay: h.media?.growthPerDay ?? null,
            engagementRate: h.media?.engagementRate ?? null,
            credibilityScore: h.credibilityScore,
            viralityScore: h.viralityScore,
          } as Record<string, unknown>,
          sourceMetadata: { platform: h.platform, channelId: h.media?.channelId ?? null } as Record<string, unknown>,
          evidenceRefs: [],
        }));
        const res = await persistFn({ data: {
          query: report.query,
          params: { period: report.period, sources: report.sourcesRequested },
          sources: report.sourcesRequested,
          period: report.period,
          hits: mapped,
          totals: { total: report.totals.total, unique: report.totals.unique, duplicatesRemoved: report.totals.duplicatesRemoved },
        } });
        if (cancelled) return;
        setPersistedScanId(res.scanId);
        setPersistSummary({ newHits: res.newHits, updatedHits: res.updatedHits, duplicatesRemoved: res.duplicatesRemoved, uniqueHits: res.uniqueHits });

        // Kick off timestamp analysis for every YouTube hit (concurrency 3, fire-and-forget).
        const ytHits = report.hits.filter((h) => h.source === "YouTube" && h.media?.videoId);
        if (ytHits.length) {
          const entityTerms = [report.query, ...report.aliases].filter(Boolean);
          setAnalyzingVideos(new Set(ytHits.map((h) => h.media!.videoId!)));
          const queue = [...ytHits];
          const runOne = async () => {
            while (queue.length && !cancelled) {
              const h = queue.shift()!;
              try {
                await analyzeFn({ data: {
                  videoId: h.media!.videoId!,
                  scanId: res.scanId,
                  entityTerms,
                  channelId: h.media?.channelId ?? null,
                  channelName: h.media?.channelTitle ?? null,
                  channelUrl: h.media?.channelUrl ?? null,
                } });
              } catch (e) {
                console.warn("[analyze]", h.media?.videoId, e);
              } finally {
                setAnalyzingVideos((s) => { const n = new Set(s); n.delete(h.media!.videoId!); return n; });
              }
            }
          };
          void Promise.all([runOne(), runOne(), runOne()]);
        }
      } catch (e) {
        console.error("[scan] persist failed:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [report, persistFn, analyzeFn]);

  const toggleSource = (s: SourceKey) => setSources((p) => p.includes(s) ? p.filter(x => x !== s) : [...p, s]);


  const split = (s: string) => s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim() || m.isPending) return;
    setAdded(new Set());
    const aliasList = split(aliases);
    const variationList = split(variations);
    const hashtagList = split(hashtags);
    const handleList = split(handles);
    m.mutate({
      query: q.trim(),
      aliases: aliasList,
      variations: variationList,
      hashtags: hashtagList,
      handles: handleList,
      monthFilter,
      sources: sources.length ? sources : DEFAULT_SOURCES,
      limit: 8,
      youtubeTarget: 1500,
      context: [industry, country, site].filter(Boolean).join(" "),
    });
  };

  const entityTerms = useMemo(
    () => [q, ...split(aliases), ...split(variations)].map((s) => s.trim()).filter(Boolean),
    [q, aliases, variations],
  );

  const promote = async (h: ScanHit) => {
    if (!userId) { toast.error("Sign in required"); return; }
    const { error } = await supabase.from("enforcement_requests").insert({
      user_id: userId,
      platform: h.platform,
      method: "DMCA",
      target_url: h.url,
      status: "Queued",
      metadata: { title: h.title, category: h.category, severity: h.severity, source: h.source },
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Queued for takedown");
    setAdded((s) => new Set(s).add(h.url));
  };

  const exportPdf = async () => {
    if (!report || pdfPending) return;

    const pdfWindow = window.open("", "_blank");
    if (pdfWindow) {
      pdfWindow.document.write(
        "<title>Preparing Evidence PDF</title><p style='font-family:Arial;padding:30px'>Preparing professional evidence PDF...</p>"
      );
    }

    setPdfPending(true);
    try {
      const result = await generateReportPdf({ data: {
        subject: q.trim() || report.query,
        period: report.period,
        generatedAt: report.generatedAt,
        reputationScore: report.reputationScore,
        reputationLevel: report.reputationLevel,
        headline: report.executiveSummary.headline,
        totals: report.totals,
        sources: report.sourcesReturned,
        immediateActions: report.executiveSummary.immediateActions,
        longTerm: report.executiveSummary.longTerm,
        hits: report.hits.map(h => ({
          title:h.title,url:h.url,description:h.description,platform:h.platform,source:h.source,author:h.author,published:h.published,category:h.category,contentLabel:h.contentLabel,severity:h.severity,sentiment:h.sentiment,threatScore:h.threatScore,credibilityScore:h.credibilityScore,reachEstimate:h.reachEstimate,engagement:h.engagement,detectionReason:h.detectionReason,recommendedAction:h.recommendedAction,discoveredAt:h.discoveredAt,
        })),
      }});
      const binary=atob(result.base64); const bytes=new Uint8Array(binary.length);
      for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);

      if (pdfWindow) {
        pdfWindow.location.href = url;
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = result.fileName || "Eterna-Evidence-Report.pdf";
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }

      window.setTimeout(() => URL.revokeObjectURL(url), 300000);
      toast.success("Evidence PDF opened — use the download button in the PDF viewer");
    } catch (error) {
      if (pdfWindow) pdfWindow.close();
      const message = error instanceof Error ? error.message : String(error);
      console.error("Evidence PDF generation failed:", error);
      alert("PDF generation failed: " + message);
      toast.error("PDF generation failed: " + message);
    }
    finally { setPdfPending(false); }
  };

  return (
    <div className="space-y-6">
      {/* Hero + form */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card">
        <div className="absolute inset-0 pointer-events-none opacity-70"
          style={{ background: "radial-gradient(600px 200px at 10% 0%, oklch(0.85 0.18 295 / 0.35), transparent 60%), radial-gradient(500px 220px at 90% 100%, oklch(0.85 0.18 320 / 0.35), transparent 60%)" }} />
        <div className="relative p-6 md:p-8">
          <div className="flex items-center gap-2 text-[10px] tracking-[0.2em] font-semibold text-muted-foreground">
            <Sparkles className="size-3.5" /> REPUTATION INTELLIGENCE REPORT
          </div>
          <h1 className="mt-2 text-2xl md:text-3xl font-display font-bold leading-tight">
            Evidence-based scan across <span className="text-gradient-brand">news, video, social & forums</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Enter a person, brand, or organization and generate a full, source-linked reputation report.
          </p>

          <form onSubmit={submit} className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Name / Brand / Organization *">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <input value={q} onChange={(e) => setQ(e.target.value)} required placeholder='e.g. "Eterna AI"' className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/25" />
              </div>
            </Field>
            <Field label="Known aliases / alternate spellings">
              <input value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="comma separated" className="w-full px-3 py-2.5 rounded-xl border border-border bg-card text-sm" />
            </Field>
            <Field label="Social handles">
              <input value={handles} onChange={(e) => setHandles(e.target.value)} placeholder="@handle1, @handle2" className="w-full px-3 py-2.5 rounded-xl border border-border bg-card text-sm" />
            </Field>
            <Field label="Official website">
              <input value={site} onChange={(e) => setSite(e.target.value)} placeholder="example.com" className="w-full px-3 py-2.5 rounded-xl border border-border bg-card text-sm" />
            </Field>
            <Field label="Country / location">
              <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="US, IN, UK…" className="w-full px-3 py-2.5 rounded-xl border border-border bg-card text-sm" />
            </Field>
            <Field label="Industry / profession">
              <input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. musician, SaaS" className="w-full px-3 py-2.5 rounded-xl border border-border bg-card text-sm" />
            </Field>
            <Field label="Name / spelling variations (Malayalam, English, nicknames)">
              <input value={variations} onChange={(e) => setVariations(e.target.value)} placeholder="comma separated" className="w-full px-3 py-2.5 rounded-xl border border-border bg-card text-sm" />
            </Field>
            <Field label="Hashtags to track">
              <input value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="#brandname, #topic" className="w-full px-3 py-2.5 rounded-xl border border-border bg-card text-sm" />
            </Field>
            <div className="md:col-span-2">
              <div className="text-[10px] tracking-[0.16em] font-semibold text-muted-foreground mb-2">Scan period</div>
              <MonthFilterButtons value={monthFilter} onChange={setMonthFilter} />
            </div>
            <div className="flex items-end">
              <button type="submit" disabled={m.isPending || !q.trim()} className="w-full flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-60 shadow-lg" style={{ background: "var(--gradient-brand)", boxShadow: "var(--shadow-elev)" }}>
                {m.isPending ? <Loader2 className="size-4 animate-spin" /> : <ScanSearch className="size-4" />}
                {m.isPending ? "Generating report…" : "Generate Reputation Report"}
              </button>
            </div>

            <div className="md:col-span-2 flex flex-wrap gap-1.5">
              {SOURCES.map((s) => {
                const on = sources.includes(s.key);
                return (
                  <button key={s.key} type="button" onClick={() => toggleSource(s.key)} className={`text-[11px] px-3 py-1.5 rounded-full border transition ${on ? "text-white border-transparent" : "border-border bg-card hover:bg-accent"}`} style={on ? { background: "var(--gradient-brand)" } : undefined}>
                    {s.label}
                  </button>
                );
              })}
            </div>
          </form>

          {m.isError && <div className="mt-4 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">Scan failed: {(m.error as Error).message}</div>}
          {report?.error &&
            !report.error.toLowerCase().includes("youtube quota exhausted") &&
            <div className="mt-4 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              Scan warning: {report.error}
            </div>}
        </div>
      </div>

      {report && report.hits.length === 0 && (
        <PageCard title="NO RESULTS" sub="No public results were returned for this query. Try broader terms, add aliases, or expand sources.">
          <div className="text-sm text-muted-foreground">Sources requested: {report.sourcesRequested.join(", ")}</div>
        </PageCard>
      )}

      {report && report.hits.length > 0 && (
        <>
          {/* Executive summary + score */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 rounded-2xl border border-border bg-card p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground">EXECUTIVE SUMMARY</div>
                  <div className="text-lg font-display font-bold mt-1">{report.executiveSummary.headline}</div>
                </div>
                <button onClick={exportPdf} disabled={pdfPending} className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-accent inline-flex items-center gap-1.5 disabled:opacity-60">{pdfPending ? <Loader2 className="size-3.5 animate-spin" /> : <FileDown className="size-3.5" />} {pdfPending ? "Building PDF..." : "Open / Download Evidence PDF"}</button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-xs">
                <Fact label="Most damaging topic" value={report.executiveSummary.mostDamagingTopic} />
                <Fact label="Most influential source" value={report.executiveSummary.mostInfluentialSource} />
                <Fact label="Fastest-growing" value={report.executiveSummary.fastestGrowing} />
                <Fact label="Trend" value={report.executiveSummary.trend} />
              </div>
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                <ActionList title="Immediate actions" items={report.executiveSummary.immediateActions} />
                <ActionList title="Long-term recommendations" items={report.executiveSummary.longTerm} />
              </div>
              <div className="mt-3 text-[11px] text-muted-foreground italic">
                This score is an analytical estimate based on public content and is not a legal finding.
              </div>
            </div>
            <div className="rounded-2xl border border-border p-6" style={{ background: `linear-gradient(135deg, color-mix(in oklab, ${scoreColor(report.reputationScore)} 18%, white), white)` }}>
              <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground">REPUTATION SCORE</div>
              <div className="mt-2 text-6xl font-display font-black" style={{ color: scoreColor(report.reputationScore) }}>{report.reputationScore}</div>
              <div className="text-sm font-semibold" style={{ color: scoreColor(report.reputationScore) }}>{report.reputationLevel}</div>
              <div className="text-[11px] text-muted-foreground mt-1">Period: {report.period} · {report.totals.unique} results</div>
              <div className="mt-4 space-y-2">
                {report.scoreBreakdown.map((b) => (
                  <div key={b.key}>
                    <div className="flex justify-between text-[11px]"><span>{b.label}</span><span className="font-semibold">{b.value}/100</span></div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full" style={{ width: `${b.value}%`, background: scoreColor(100 - b.value) }} /></div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <KPI label="Total unique" value={report.totals.unique} icon={<Eye className="size-4" />} tone="brand" />
            <KPI label="Breaking (24h)" value={report.buckets.breaking.length} icon={<Bell className="size-4" />} tone="danger" />
            <KPI label="Critical" value={report.totals.critical} icon={<AlertTriangle className="size-4" />} tone="danger" />
            <KPI label="High" value={report.totals.high} icon={<ShieldAlert className="size-4" />} tone="warn" />
            <KPI label="Viral" value={report.totals.viral} icon={<Flame className="size-4" />} tone="viral" />
            <KPI label="Reach" value={fmt(report.totals.totalReach)} icon={<Users className="size-4" />} tone="brand" />
          </div>

          {/* ── Eterna Intelligence Status Card — user-facing clean view ── */}
          <EternaStatusCard report={report} />

          {/* ── Admin Diagnostics — hidden from users, visible in dev or ?diag=1 ── */}
          <AdminDiagnosticsPanel report={report} />

          {/* DB-backed persisted results with cursor-paginated infinite scroll */}
          <PersistedResults scanId={persistedScanId} summary={persistSummary} scanStatus={report ? "completed" : "running"} />

          {/* ═══════════════════════════════════════════════════════════
              TIME-WINDOW BUCKETS — primary discovery view
              Show freshest content first; older results below.
          ══════════════════════════════════════════════════════════ */}

          {/* Breaking (last 24 hours) */}
          {report.buckets.breaking.length > 0 && (
            <div className="rounded-2xl border-2 border-red-500/40 bg-red-50/30 dark:bg-red-950/10 overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-3 bg-red-500/10">
                <span className="relative flex size-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-80" />
                  <span className="relative inline-flex size-2.5 rounded-full bg-red-500" />
                </span>
                <span className="text-[11px] font-bold tracking-widest text-red-600 dark:text-red-400 uppercase">Breaking · Last 24 Hours</span>
                <span className="ml-auto text-[11px] text-red-500 font-semibold">{report.buckets.breaking.length} result{report.buckets.breaking.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="p-4">
                <Bucket title="" icon={<Bell className="size-4" />} hits={report.buckets.breaking} onPromote={promote} added={added} entityTerms={entityTerms} scanId={persistedScanId} analyzingVideos={analyzingVideos} hideCard />
              </div>
            </div>
          )}

          <Bucket title="LAST 3 DAYS" icon={<Clock className="size-4" />} hits={report.buckets.recent3d} onPromote={promote} added={added} entityTerms={entityTerms} scanId={persistedScanId} analyzingVideos={analyzingVideos} />
          <Bucket title="LAST 7 DAYS" icon={<Clock className="size-4" />} hits={report.buckets.recent7d} onPromote={promote} added={added} entityTerms={entityTerms} scanId={persistedScanId} analyzingVideos={analyzingVideos} />
          <Bucket title="LAST 30 DAYS" icon={<Clock className="size-4" />} hits={report.buckets.recent30d} onPromote={promote} added={added} entityTerms={entityTerms} scanId={persistedScanId} analyzingVideos={analyzingVideos} />

          {/* ═══════════════════════════════════════════════════════════
              RISK CATEGORY BUCKETS
          ══════════════════════════════════════════════════════════ */}
          <Bucket title="CRITICAL THREATS" icon={<AlertTriangle className="size-4" />} hits={report.buckets.critical} onPromote={promote} added={added} entityTerms={entityTerms} scanId={persistedScanId} analyzingVideos={analyzingVideos} />
          <Bucket title="DEFAMATION RISK" icon={<Gavel className="size-4" />} hits={report.buckets.defamation} onPromote={promote} added={added} entityTerms={entityTerms} scanId={persistedScanId} analyzingVideos={analyzingVideos} />
          <Bucket title="EXPOSÉ / ALLEGATIONS" icon={<ShieldAlert className="size-4" />} hits={report.buckets.expose} onPromote={promote} added={added} entityTerms={entityTerms} scanId={persistedScanId} analyzingVideos={analyzingVideos} />
          <Bucket title="LEAKS" icon={<EyeOff className="size-4" />} hits={report.buckets.leaks} onPromote={promote} added={added} entityTerms={entityTerms} scanId={persistedScanId} analyzingVideos={analyzingVideos} />
          <Bucket title="CONTROVERSIES / BOYCOTTS" icon={<Flame className="size-4" />} hits={report.buckets.controversies} onPromote={promote} added={added} entityTerms={entityTerms} scanId={persistedScanId} analyzingVideos={analyzingVideos} />
          <Bucket title="HARASSMENT / ABUSE" icon={<XIcon className="size-4" />} hits={report.buckets.harassment} onPromote={promote} added={added} entityTerms={entityTerms} scanId={persistedScanId} analyzingVideos={analyzingVideos} />
          <Bucket title="LEGAL DISPUTES" icon={<Gavel className="size-4" />} hits={report.buckets.legal} onPromote={promote} added={added} entityTerms={entityTerms} scanId={persistedScanId} analyzingVideos={analyzingVideos} />
          <Bucket title="DEEPFAKE / MANIPULATED MEDIA" icon={<ShieldAlert className="size-4" />} hits={report.buckets.deepfake} onPromote={promote} added={added} entityTerms={entityTerms} scanId={persistedScanId} analyzingVideos={analyzingVideos} />
          <Bucket title="IMPERSONATION / FAKE ENDORSEMENTS" icon={<BadgeCheck className="size-4" />} hits={report.buckets.impersonation} onPromote={promote} added={added} entityTerms={entityTerms} scanId={persistedScanId} analyzingVideos={analyzingVideos} />
          <Bucket title="VIRAL / EMERGING" icon={<TrendingUp className="size-4" />} hits={report.buckets.emerging} onPromote={promote} added={added} entityTerms={entityTerms} scanId={persistedScanId} analyzingVideos={analyzingVideos} />

          {/* ═══════════════════════════════════════════════════════════
              SOURCE BUCKETS
          ══════════════════════════════════════════════════════════ */}
          <Bucket title="YOUTUBE — FRESHEST FIRST" icon={<Youtube className="size-4" />} hits={report.buckets.youtube} onPromote={promote} added={added} entityTerms={entityTerms} scanId={persistedScanId} analyzingVideos={analyzingVideos} />
          <Bucket title="NEWS COVERAGE" icon={<Newspaper className="size-4" />} hits={report.buckets.news} onPromote={promote} added={added} entityTerms={entityTerms} scanId={persistedScanId} analyzingVideos={analyzingVideos} />
          <Bucket title="REDDIT DISCUSSIONS" icon={<MessageCircle className="size-4" />} hits={report.buckets.reddit} onPromote={promote} added={added} entityTerms={entityTerms} scanId={persistedScanId} analyzingVideos={analyzingVideos} />
          <Bucket title="INSTAGRAM MONITORING" icon={<Instagram className="size-4" />} hits={report.buckets.instagram} onPromote={promote} added={added} entityTerms={entityTerms} scanId={persistedScanId} analyzingVideos={analyzingVideos} />
          <Bucket title="FACEBOOK MONITORING" icon={<Facebook className="size-4" />} hits={report.buckets.facebook} onPromote={promote} added={added} entityTerms={entityTerms} scanId={persistedScanId} analyzingVideos={analyzingVideos} />
          <Bucket title="COPYRIGHT / REUPLOADS" icon={<Copyright className="size-4" />} hits={report.buckets.copyright} onPromote={promote} added={added} entityTerms={entityTerms} scanId={persistedScanId} analyzingVideos={analyzingVideos} />
          <Bucket title="REVIEWS & COMPLAINTS" icon={<Gavel className="size-4" />} hits={report.buckets.reviews} onPromote={promote} added={added} entityTerms={entityTerms} scanId={persistedScanId} analyzingVideos={analyzingVideos} />

          <PageCard title="METHODOLOGY & LIMITATIONS" sub="How Eterna AI produced this report">
            <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-1">
              <li>Sources checked: {report.sourcesReturned.join(", ") || "—"}</li>
              <li>Requested sources: {report.sourcesRequested.join(", ")}</li>
              <li>Unique results: {report.totals.unique} · duplicates removed: {report.totals.duplicatesRemoved}</li>
              <li>Only public web content is collected via Firecrawl; no private accounts, paywalls, or authenticated pages are accessed.</li>
              <li>Threat and reputation scores are analytical estimates, not legal findings. Allegations are labeled as such and are not treated as verified facts.</li>
              <li>Report generated {new Date(report.generatedAt).toLocaleString()}.</li>
            </ul>
          </PageCard>
        </>
      )}

      {!report && !m.isPending && (
        <PageCard title="HOW IT WORKS" sub="Powered by Firecrawl + Eterna AI risk model">
          <ol className="text-sm text-muted-foreground space-y-2 list-decimal pl-5">
            <li>Enter the subject's name, aliases, handles, website, and industry context.</li>
            <li>Pick the sources (News, YouTube, Reddit, X, Reviews, and more).</li>
            <li>Eterna AI runs parallel searches, classifies each hit for category, sentiment, credibility, reach, and threat, then computes an overall Reputation Score.</li>
            <li>Review findings by section, export as CSV, or promote high-risk items to the Threat Radar for enforcement.</li>
          </ol>
        </PageCard>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EternaStatusCard — clean, provider-agnostic intelligence status for all users.
// NO provider names, quota details, API errors, or internal architecture exposed.
// ---------------------------------------------------------------------------
const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";

function EternaStatusCard({ report }: { report: ReportWithDiagnostics }) {
  const diag = report.diagnostics;
  const hits = report.hits;

  // Derived clean metrics — no provider naming
  const videoFindings   = hits.filter(h => h.source === "YouTube").length;
  const newsFindings    = hits.filter(h => h.source === "News").length;
  const socialFindings  = hits.filter(h => ["Reddit","Instagram","X","TikTok","Facebook"].includes(h.source)).length;
  const webFindings     = hits.filter(h => h.source === "Web").length;
  const otherFindings   = Math.max(0, hits.length - videoFindings - newsFindings - socialFindings - webFindings);
  const criticalCount   = report.totals.critical;
  const highCount       = report.totals.high;
  const viralCount      = report.totals.viral;
  const reach           = report.totals.totalReach;
  const sourcesCount    = diag?.sourcesWithResults?.length ?? report.sourcesReturned.length;
  const scannedAt       = diag?.scannedAt;

  // Generic "some sources limited" notice — never names the provider
  const hasPartialCoverage =
    !DEMO_MODE && (
      diag?.youtube?.quotaExhausted ||
      diag?.youtube?.status === "quota_exhausted"
    );

  const scanTime = scannedAt
    ? new Date(scannedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;

  return (
    <div className="rounded-2xl border border-border bg-card px-6 py-5">
      {/* Header row */}
      <div className="flex items-center justify-between mb-5 gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="relative flex size-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full size-2.5 bg-green-500" />
          </span>
          <span className="text-[11px] font-bold tracking-wider text-green-600 dark:text-green-400 uppercase">
            Live Reputation Scan · Complete
          </span>
          {scanTime && <span className="text-[11px] text-muted-foreground">— {scanTime}</span>}
        </div>
        <span className="text-[11px] text-muted-foreground font-medium">Period: {report.period}</span>
      </div>

      {/* Primary metrics grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {([
          { label: "Unique Findings",   val: hits.length.toLocaleString(),    accent: false },
          { label: "Sources Monitored", val: String(sourcesCount),            accent: false },
          { label: "Estimated Reach",   val: fmt(reach),                      accent: false },
          { label: "Critical Threats",  val: String(criticalCount),           accent: criticalCount > 0 },
        ] as { label: string; val: string; accent: boolean }[]).map(({ label, val, accent }) => (
          <div key={label} className="rounded-xl border border-border bg-background/60 p-3 text-center">
            <div className={`text-xl font-bold font-display ${accent ? "text-red-500" : "text-foreground"}`}>{val}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5 uppercase tracking-wide">{label}</div>
          </div>
        ))}
      </div>

      {/* Source breakdown chips */}
      <div className="flex flex-wrap gap-2 mb-4">
        {videoFindings  > 0 && <IntelChip label="Video findings"      count={videoFindings}  />}
        {newsFindings   > 0 && <IntelChip label="News findings"       count={newsFindings}   />}
        {socialFindings > 0 && <IntelChip label="Social/web findings" count={socialFindings} />}
        {webFindings    > 0 && <IntelChip label="Web findings"        count={webFindings}    />}
        {otherFindings  > 0 && <IntelChip label="Other findings"      count={otherFindings}  />}
        {highCount      > 0 && <IntelChip label="High-risk findings"  count={highCount}  danger />}
        {viralCount     > 0 && <IntelChip label="Viral signals"       count={viralCount} warn />}
      </div>

      {/* Status line */}
      {hasPartialCoverage ? (
        <p className="text-[11px] text-muted-foreground border-t border-border pt-3 mt-1">
          ⓘ Some sources are temporarily limited. Eterna continued scanning using alternate discovery sources.
        </p>
      ) : (
        <p className="text-[11px] text-green-600 dark:text-green-400 border-t border-border pt-3 mt-1">
          ✓ Fresh intelligence collected successfully.
        </p>
      )}
    </div>
  );
}

function IntelChip({ label, count, danger, warn }: { label: string; count: number; danger?: boolean; warn?: boolean }) {
  const textColor = danger ? "text-red-500" : warn ? "text-amber-500" : "text-primary";
  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-background text-[11px] font-semibold">
      <span className={`font-bold ${textColor}`}>{count.toLocaleString()}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AdminDiagnosticsPanel — technical internals gated to dev mode or ?diag=1.
// Contains: YouTube API state, Firecrawl status, per-source raw counts, errors.
// NEVER visible to normal users or in DEMO MODE.
// ---------------------------------------------------------------------------
function AdminDiagnosticsPanel({ report }: { report: ReportWithDiagnostics }) {
  const diag = report.diagnostics;
  // Only render in dev build, or when the URL has ?diag=1 (admin shortcut)
  const isAdminView =
    import.meta.env.DEV ||
    (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("diag") === "1");

  if (!isAdminView || !diag || DEMO_MODE) return null;

  return (
    <details className="rounded-2xl border border-dashed border-amber-300 dark:border-amber-700/50 bg-amber-50/30 dark:bg-amber-950/10 px-5 py-3">
      <summary className="text-[10px] font-bold tracking-widest uppercase text-amber-600 dark:text-amber-400 cursor-pointer select-none">
        ⚙ Admin · Technical Diagnostics (dev only — not visible to users)
      </summary>
      <div className="mt-4">
        <LiveScanStatus
          sourceCounts={diag.sourceCounts ?? {}}
          totalRaw={diag.totalRawFetched ?? 0}
          sourcesWithResults={diag.sourcesWithResults ?? []}
          scannedAt={diag.scannedAt}
          ytDiag={diag.youtube}
          fcDiscovery={diag.firecrawlDiscovery}
        />
        {(diag as { monthWindow?: { filter: string; label: string; startIso: string; endIso: string } }).monthWindow && (
          <div className="mt-3 text-[11px] text-muted-foreground">
            Scan range: {(diag as { monthWindow?: { label: string; startIso: string; endIso: string } }).monthWindow?.label} · {(diag as { monthWindow?: { startIso: string; endIso: string } }).monthWindow?.startIso} → {(diag as { monthWindow?: { endIso: string } }).monthWindow?.endIso}
          </div>
        )}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// MonthFilterButtons — 3 compact buttons for This Month / Previous Month / Two Months Ago.
// Labels are computed dynamically from the current date — never hardcoded.
// ---------------------------------------------------------------------------
function getClientMonthLabel(filter: "this" | "previous" | "twoAgo"): { label: string; sub: string } {
  const now = new Date();
  const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const yr = now.getFullYear(); const mo = now.getMonth();
  let y: number, m: number;
  if (filter === "this")     { y = yr; m = mo; }
  else if (filter === "previous") { m = mo === 0 ? 11 : mo - 1; y = mo === 0 ? yr - 1 : yr; }
  else { m = mo <= 1 ? mo + 10 : mo - 2; y = mo <= 1 ? yr - 1 : yr; }
  const monthStart = new Date(y, m, 1);
  const monthEnd   = filter === "this" ? now : new Date(y, m + 1, 0);
  const fmt = (d: Date) => `${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0, 3)}`;
  return { label: MONTH_NAMES[m], sub: `${fmt(monthStart)} – ${fmt(monthEnd)} ${y}` };
}

function MonthFilterButtons({
  value,
  onChange,
}: {
  value: "24h" | "7d" | "30d" | "12m" | "all";
  onChange: (value: "24h" | "7d" | "30d" | "12m" | "all") => void;
}) {
  const ranges = [
    { value: "24h", title: "Latest", detail: "24 hours" },
    { value: "7d", title: "Recent", detail: "7 days" },
    { value: "30d", title: "Monthly", detail: "30 days" },
    { value: "12m", title: "Recommended", detail: "12 months" },
    { value: "all", title: "Archive", detail: "All time" },
  ] as const;
  return (
    <div className="flex flex-wrap gap-2">
      {ranges.map((range) => {
        const active = value === range.value;
        return (
          <button
            key={range.value}
            type="button"
            onClick={() => onChange(range.value)}
            className="flex flex-col items-start px-4 py-2.5 rounded-xl border transition-all text-left"
            style={active
              ? { background: "var(--gradient-brand)", borderColor: "transparent", color: "#fff" }
              : { background: "var(--color-card)", borderColor: "var(--color-border)" }}
          >
            <span className="text-[11px] font-bold tracking-wide" style={active ? { opacity: 0.85 } : { color: "var(--color-muted-foreground)" }}>
              {range.title}
            </span>
            <span className="text-[13px] font-semibold leading-tight">{range.detail}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live Scan Status — shows actual source counts returned from the server.
// This component prevents the "65 total but only 1 YouTube" confusion by
// displaying the real per-source fetch counts from the API diagnostics.
// ---------------------------------------------------------------------------
const SOURCE_ICONS: Record<string, React.ReactNode> = {
  YouTube:   <Youtube className="size-3.5" />,
  News:      <Newspaper className="size-3.5" />,
  Reddit:    <MessageCircle className="size-3.5" />,
  Web:       <Globe className="size-3.5" />,
  Instagram: <Instagram className="size-3.5" />,
  Facebook:  <Facebook className="size-3.5" />,
};

function LiveScanStatus({
  sourceCounts,
  totalRaw,
  sourcesWithResults,
  scannedAt,
  ytDiag,
  fcDiscovery,
}: {
  sourceCounts: Record<string, number>;
  totalRaw: number;
  sourcesWithResults: string[];
  scannedAt?: string;
  ytDiag?: YtDiag;
  fcDiscovery?: FcDiscoveryDiag;
}) {
  const entries = Object.entries(sourceCounts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const scanTime = scannedAt ? new Date(scannedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : null;
  const ytQuotaExhausted = ytDiag?.quotaExhausted || ytDiag?.status === "quota_exhausted";
  const fcActive = fcDiscovery?.active === true;

  if (!entries.length && !ytDiag && !fcDiscovery) return null;

  return (
    <div className="space-y-3">

      {/* ── YouTube API status panel ─────────────────────────────────── */}
      {ytDiag && (
        <div className={`rounded-2xl border px-5 py-4 ${
          ytQuotaExhausted
            ? "border-red-300 bg-red-50/40 dark:bg-red-950/10"
            : "border-border bg-card"
        }`}>
          <div className="flex items-center justify-between mb-3 gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              {ytQuotaExhausted ? (
                <>
                  <AlertTriangle className="size-3.5 text-red-500" />
                  <span className="text-[11px] font-bold tracking-wider text-red-600 dark:text-red-400 uppercase">YouTube API · Quota Exhausted</span>
                  {ytDiag.quotaReason && <span className="text-[10px] text-red-400 ml-1">({ytDiag.quotaReason})</span>}
                </>
              ) : (
                <>
                  <span className="relative flex size-2.5">
                    <span className="relative inline-flex rounded-full size-2.5 bg-green-500" />
                  </span>
                  <span className="text-[11px] font-bold tracking-wider text-green-600 dark:text-green-400 uppercase">YouTube API · Active</span>
                </>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {ytQuotaExhausted ? (
                <span className="text-red-500 font-semibold">Firecrawl Discovery Mode activated automatically</span>
              ) : (
                <span><strong className="text-foreground">{ytDiag.videosFound}</strong> videos found</span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted-foreground">
            <span>Queries run: <strong className="text-foreground">{ytDiag.queriesRun}</strong></span>
            <span>Pages scanned: <strong className="text-foreground">{ytDiag.pagesScanned}</strong></span>
            <span>Videos found: <strong className={ytQuotaExhausted ? "text-red-500" : "text-foreground"}>{ytDiag.videosFound}</strong></span>
            {ytDiag.apiErrors > 0 && <span className="text-amber-500 font-semibold">API errors: {ytDiag.apiErrors}</span>}
          </div>
          {ytQuotaExhausted && (
            <div className="mt-3 text-[11px] text-red-600 dark:text-red-400 bg-red-100/60 dark:bg-red-900/20 rounded-lg px-3 py-2">
              ⚡ YouTube Data API daily quota exhausted. All YouTube content is now discovered through Firecrawl's public web index (site:youtube.com searches). Results are normalized and displayed identically.
            </div>
          )}
        </div>
      )}

      {/* ── Firecrawl Discovery Mode panel ──────────────────────────── */}
      {fcActive && fcDiscovery && (
        <div className="rounded-2xl border border-blue-200 dark:border-blue-800/40 bg-blue-50/30 dark:bg-blue-950/10 px-5 py-4">
          <div className="flex items-center justify-between mb-3 gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="relative flex size-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex rounded-full size-2.5 bg-blue-500" />
              </span>
              <span className="text-[11px] font-bold tracking-wider text-blue-600 dark:text-blue-400 uppercase">Firecrawl Discovery Mode · Active</span>
            </div>
            <div className="text-[11px] text-muted-foreground">
              <strong className="text-foreground">{fcDiscovery.uniqueUrls ?? 0}</strong> unique URLs discovered ·{" "}
              <strong className="text-foreground">{fcDiscovery.queriesExecuted ?? 0}</strong> queries executed
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            {([
              { label: "YouTube URLs",  val: fcDiscovery.youtubeUrlsDiscovered ?? 0, color: "text-red-500" },
              { label: "News",          val: fcDiscovery.newsDiscovered ?? 0,         color: "text-blue-600" },
              { label: "Social/Web",   val: fcDiscovery.socialDiscovered ?? 0,       color: "text-purple-600" },
              { label: "Other Web",    val: fcDiscovery.otherWebDiscovered ?? 0,     color: "text-muted-foreground" },
            ] as { label: string; val: number; color: string }[]).map(({ label, val, color }) => (
              <div key={label} className="rounded-lg bg-white/60 dark:bg-white/5 border border-blue-100 dark:border-blue-800/30 p-2 text-center">
                <div className={`text-sm font-bold ${color}`}>{val}</div>
                <div className="text-[10px] text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>

          {/* Query breakdown */}
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted-foreground">
            <span>Tier-1 queries: <strong className="text-foreground">{fcDiscovery.tier1Queries ?? 0}</strong></span>
            <span>Tier-2 (expanded): <strong className="text-foreground">{fcDiscovery.tier2Queries ?? 0}</strong></span>
            <span>YouTube web queries: <strong className="text-foreground">{fcDiscovery.ytWebQueries ?? 0}</strong></span>
            <span>Raw fetched: <strong className="text-foreground">{fcDiscovery.rawUrls ?? 0}</strong></span>
          </div>
          {(fcDiscovery.expandedTermsUsed?.length ?? 0) > 0 && (
            <div className="mt-2 text-[11px] text-blue-600 dark:text-blue-400">
              Discovered keywords: {fcDiscovery.expandedTermsUsed!.join(" · ")}
            </div>
          )}
        </div>
      )}

      {/* ── Source count chips + overall stats ──────────────────────── */}
      <div className="rounded-2xl border border-border bg-card px-5 py-4">
        <div className="flex items-center justify-between mb-3 gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="relative flex size-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full size-2.5 bg-green-500" />
            </span>
            <span className="text-[11px] font-bold tracking-wider text-green-600 dark:text-green-400 uppercase">Web Discovery · Complete</span>
            {scanTime && <span className="text-[11px] text-muted-foreground">— {scanTime}</span>}
          </div>
          <div className="text-[11px] text-muted-foreground">
            <span className="font-semibold text-foreground">{totalRaw.toLocaleString()}</span> raw results across{" "}
            <span className="font-semibold text-foreground">{sourcesWithResults.length}</span> source{sourcesWithResults.length !== 1 ? "s" : ""}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {entries.map(([src, count]) => (
            <div key={src} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-background text-[11px] font-semibold">
              <span className="text-muted-foreground">{SOURCE_ICONS[src] ?? <Globe className="size-3.5" />}</span>
              <span>{src}</span>
              <span className="text-primary font-bold">{count.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10px] tracking-[0.16em] font-semibold text-muted-foreground mb-1.5">{label}</div>
      {children}
    </label>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-2.5 bg-background/50">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-xs font-semibold mt-0.5 truncate">{value}</div>
    </div>
  );
}

function ActionList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-3 bg-muted/30">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">{title}</div>
      <ul className="text-xs space-y-1 list-disc pl-4">{items.map((i, idx) => <li key={idx}>{i}</li>)}</ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FreshnessBadge — prominent pill showing how recently published a result is.
// Only appears for results < 30 days old, color-coded from red (breaking) to amber.
// ---------------------------------------------------------------------------
const FRESHNESS_CONFIG: Record<string, { label: string; bg: string; dot: string }> = {
  "24h": { label: "Breaking · <24h",  bg: "oklch(0.97 0.06 25)",  dot: "bg-red-500"    },
  "3d":  { label: "Fresh · 3 days",   bg: "oklch(0.96 0.07 35)",  dot: "bg-orange-500" },
  "7d":  { label: "Recent · 7 days",  bg: "oklch(0.96 0.06 55)",  dot: "bg-amber-500"  },
  "30d": { label: "Last 30 days",     bg: "oklch(0.97 0.04 75)",  dot: "bg-yellow-500" },
};
const FRESHNESS_TEXT: Record<string, string> = {
  "24h": "oklch(0.52 0.22 25)",
  "3d":  "oklch(0.55 0.2 35)",
  "7d":  "oklch(0.55 0.18 55)",
  "30d": "oklch(0.55 0.14 75)",
};

function FreshnessBadge({ window }: { window: FreshnessWindow }) {
  const cfg = FRESHNESS_CONFIG[window];
  if (!cfg) return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full mb-1.5"
      style={{ background: cfg.bg, color: FRESHNESS_TEXT[window] }}
    >
      <span className={`size-1.5 rounded-full shrink-0 ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function KPI({ label, value, icon, tone }: { label: string; value: string | number; icon: React.ReactNode; tone: "brand"|"danger"|"warn"|"viral" }) {
  const bg =
    tone === "danger" ? "linear-gradient(135deg, oklch(0.96 0.06 25), oklch(0.94 0.1 25 / 0.6))" :
    tone === "warn" ? "linear-gradient(135deg, oklch(0.96 0.06 70), oklch(0.94 0.1 70 / 0.6))" :
    tone === "viral" ? "linear-gradient(135deg, oklch(0.94 0.08 35), oklch(0.94 0.1 55 / 0.6))" :
    "linear-gradient(135deg, oklch(0.96 0.05 295), oklch(0.94 0.08 320 / 0.6))";
  const color =
    tone === "danger" ? "oklch(0.5 0.22 25)" :
    tone === "warn" ? "oklch(0.55 0.18 70)" :
    tone === "viral" ? "oklch(0.55 0.2 35)" :
    "oklch(0.45 0.22 295)";
  return (
    <div className="rounded-2xl p-4 border border-border" style={{ background: bg }}>
      <div className="flex items-center justify-between">
        <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground">{label}</div>
        <span className="size-7 grid place-items-center rounded-full bg-white/70" style={{ color }}>{icon}</span>
      </div>
      <div className="mt-2 text-2xl font-display font-bold" style={{ color }}>{value}</div>
    </div>
  );
}

type SortKey = "newest" | "critical" | "viral" | "growth" | "reach" | "discussed" | "shared" | "threat";
const SORT_LABEL: Record<SortKey, string> = {
  newest: "Newest",
  critical: "Critical",
  viral: "Viral",
  growth: "Fastest growing",
  reach: "Highest reach",
  discussed: "Most discussed",
  shared: "Most shared",
  threat: "Threat",
};
const SEV_RANK: Record<string, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 };
const PAGE_SIZE = 24;

function Bucket({ title, icon, hits, onPromote, added, entityTerms, scanId, analyzingVideos, hideCard }: { title: string; icon: React.ReactNode; hits: ScanHit[]; onPromote: (h: ScanHit) => void; added: Set<string>; entityTerms: string[]; scanId: string | null; analyzingVideos: Set<string>; hideCard?: boolean }) {
  const [sort, setSort] = useState<SortKey>("newest");
  const [sentimentFilter, setSentimentFilter] = useState<string>("All");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const filtered = useMemo(() => {
    let list = sentimentFilter === "All" ? hits : hits.filter((h) => h.sentiment === sentimentFilter);
    const by = <T,>(fn: (h: ScanHit) => T) => (a: ScanHit, b: ScanHit) => (fn(b) as number) - (fn(a) as number);
    switch (sort) {
      case "newest":    list = [...list].sort(by((h) => h.published ? new Date(h.published).getTime() : 0)); break;
      case "reach":     list = [...list].sort(by((h) => h.reachEstimate)); break;
      case "growth":    list = [...list].sort(by((h) => h.media?.growthPerDay ?? 0)); break;
      case "viral":     list = [...list].sort(by((h) => h.viralityScore + (h.viral ? 20 : 0))); break;
      case "critical":  list = [...list].sort(by((h) => (SEV_RANK[h.severity] ?? 0) * 100 + h.threatScore)); break;
      case "discussed": list = [...list].sort(by((h) => h.media?.comments ?? h.engagement)); break;
      case "shared":    list = [...list].sort(by((h) => h.media?.likes ?? h.engagement)); break;
      default:          list = [...list].sort(by((h) => h.threatScore));
    }
    return list;
  }, [hits, sort, sentimentFilter]);
  if (!hits.length) return null;
  const shown = filtered.slice(0, visible);

  const controls = (
    <div className="flex items-center gap-2 flex-wrap">
      <select value={sentimentFilter} onChange={(e) => setSentimentFilter(e.target.value)} className="text-xs px-3 py-1.5 rounded-full border border-border bg-card">
        <option>All</option><option>Negative</option><option>Neutral</option><option>Positive</option>
      </select>
      <select value={sort} onChange={(e) => { setSort(e.target.value as SortKey); setVisible(PAGE_SIZE); }} className="text-xs px-3 py-1.5 rounded-full border border-border bg-card">
        {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
      </select>
    </div>
  );

  const grid = (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {shown.map((h) => <ResultCard key={h.id + h.url} h={h} added={added.has(h.url)} onPromote={() => onPromote(h)} entityTerms={entityTerms} scanId={scanId} analysisPending={!!(h.media?.videoId && analyzingVideos.has(h.media.videoId))} />)}
      </div>
      {filtered.length > visible && (
        <div className="mt-4 flex justify-center">
          <button onClick={() => setVisible((v) => v + PAGE_SIZE)} className="text-xs px-4 py-2 rounded-full border border-border hover:bg-accent font-semibold">
            Load more · {filtered.length - visible} remaining
          </button>
        </div>
      )}
    </>
  );

  if (hideCard) return (
    <div>
      <div className="flex items-center gap-2 mb-3">{controls}</div>
      {grid}
    </div>
  );

  return (
    <PageCard
      title={title}
      sub={`${filtered.length} of ${hits.length} result${hits.length === 1 ? "" : "s"}`}
      actions={controls}
    >
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground mb-2"><span className="opacity-60">{icon}</span></div>
      {grid}
    </PageCard>
  );
}

function ResultCard({ h, added, onPromote, entityTerms, scanId, analysisPending }: { h: ScanHit; added: boolean; onPromote: () => void; entityTerms: string[]; scanId: string | null; analysisPending: boolean }) {
  const sev = severityColor(h.severity);
  const [open, setOpen] = useState(false);
  const [moments, setMoments] = useState(false);
  const [imgOk, setImgOk] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const isYouTube = h.source === "YouTube";
  const rawThumb = h.media?.thumbnailHi || h.media?.thumbnail || (isYouTube ? youtubeThumbFromUrl(h.url, "maxres") : null);
  const thumb = viaProxy(rawThumb) ?? (isYouTube ? youtubeThumbFromUrl(h.url, "hq") : null);
  const displayTitle = cleanTitle(h.title, readableFromSlug(h.url));
  const host = hostFromUrl(h.url);
  const favicon = faviconUrl(h.url);
  const publishedTs = h.published ? new Date(h.published).getTime() : 0;
  const publishedLabel = publishedTs ? new Date(publishedTs).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";
  const ageDays = publishedTs ? Math.max(0, (Date.now() - publishedTs) / 86400000) : 0;
  const ageLabel = !publishedTs ? "" : ageDays < 1 ? `${Math.max(1, Math.round(ageDays * 24))}h ago` : ageDays < 30 ? `${Math.round(ageDays)}d ago` : ageDays < 365 ? `${Math.round(ageDays / 30)}mo ago` : `${Math.round(ageDays / 365)}y ago`;
  const m = h.media;
  const growth = m?.growthPerDay ?? 0;
  const trend: { label: string; color: string } | null =
    growth >= 20000 ? { label: "Exploding", color: "oklch(0.63 0.24 25)" } :
    growth >= 5000 ? { label: "Rising", color: "oklch(0.7 0.2 35)" } :
    growth >= 500 ? { label: "Growing", color: "oklch(0.75 0.16 70)" } :
    publishedTs ? { label: "Steady", color: "oklch(0.68 0.16 155)" } : null;

  return (
    <div className="group relative rounded-2xl border border-border bg-card overflow-hidden hover:shadow-lg transition-shadow flex flex-col">
      {/* Thumbnail */}
      {thumb && imgOk ? (
        <a href={h.url} target="_blank" rel="noreferrer" className="relative block aspect-video overflow-hidden bg-muted">
          {!loaded && <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-muted to-muted-foreground/10" />}
          <img
            src={thumb}
            alt={displayTitle}
            loading="lazy"
            onLoad={() => setLoaded(true)}
            onError={(e) => {
              const img = e.currentTarget as HTMLImageElement;
              const hq = isYouTube ? youtubeThumbFromUrl(h.url, "hq") : null;
              if (hq && img.src !== hq) { img.src = hq; return; }
              setImgOk(false);
            }}
            className={`w-full h-full object-cover transition-all duration-500 group-hover:scale-105 ${loaded ? "opacity-100" : "opacity-0"}`}
          />
          {/* bottom gradient */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent pointer-events-none" />
          {/* play button */}
          <div className="absolute inset-0 grid place-items-center">
            <div className="size-14 rounded-full bg-white/25 backdrop-blur-sm grid place-items-center border border-white/40 group-hover:bg-white/40 transition">
              <svg viewBox="0 0 24 24" className="size-6 text-white translate-x-0.5" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
            </div>
          </div>
          {/* top-left badges */}
          <div className="absolute top-3 left-3 flex items-center gap-1.5">
            {isYouTube && (
              <span className="text-[10px] font-bold px-2 py-1 rounded-md bg-red-600 text-white inline-flex items-center gap-1">
                <Youtube className="size-3" /> YOUTUBE
              </span>
            )}
            <span className="text-[10px] font-bold px-2 py-1 rounded-md text-white" style={{ background: sev }}>
              {h.severity.toUpperCase()}
            </span>
            {h.viral && (
              <span className="text-[10px] font-bold px-2 py-1 rounded-md bg-amber-500 text-white inline-flex items-center gap-1">
                <Flame className="size-3" /> VIRAL
              </span>
            )}
          </div>
          {/* duration */}
          {m?.duration && (
            <div className="absolute bottom-3 right-3 text-[11px] font-bold px-1.5 py-0.5 rounded bg-black/85 text-white tabular-nums">
              {m.duration}
            </div>
          )}
          {/* hover watch label */}
          <div className="absolute bottom-3 left-3 text-[11px] font-semibold text-white opacity-0 group-hover:opacity-100 transition inline-flex items-center gap-1">
            <ExternalLink className="size-3" /> Watch on {isYouTube ? "YouTube" : h.platform}
          </div>
        </a>
      ) : (
        <a href={h.url} target="_blank" rel="noreferrer" className="relative block aspect-video bg-gradient-to-br from-muted/60 to-secondary/60 overflow-hidden">
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
            {favicon ? (
              <img src={favicon} alt="" className="size-10 rounded-md bg-white/80 p-1.5 shadow-sm" />
            ) : (
              <div className="size-10 rounded-md grid place-items-center bg-white/80 text-muted-foreground shadow-sm">
                <Globe className="size-5" />
              </div>
            )}
            <div className="text-[11px] font-semibold text-foreground/80 truncate max-w-full">{host ?? h.platform}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{h.source}</div>
          </div>
          <div className="absolute top-3 left-3 flex items-center gap-1.5">
            <span className="text-[10px] font-bold px-2 py-1 rounded-md text-white" style={{ background: sev }}>{h.severity.toUpperCase()}</span>
            {h.viral && <span className="text-[10px] font-bold px-2 py-1 rounded-md bg-amber-500 text-white inline-flex items-center gap-1"><Flame className="size-3" /> VIRAL</span>}
          </div>
        </a>
      )}

      {/* Body */}
      <div className="p-5 flex-1 flex flex-col gap-3">
        <div>
          {/* Freshness badge */}
          {h.freshnessWindow && h.freshnessWindow !== "older" && (
            <FreshnessBadge window={h.freshnessWindow} />
          )}
          <a href={h.url} target="_blank" rel="noreferrer" className="block text-base font-semibold leading-snug line-clamp-3 hover:underline">{displayTitle}</a>
          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
            {m?.channelUrl ? (
              <a href={m.channelUrl} target="_blank" rel="noreferrer" className="font-semibold text-foreground hover:underline">{m.channelTitle ?? h.author ?? h.platform}</a>
            ) : (
              <span className="font-semibold text-foreground">{h.author ?? h.platform}</span>
            )}
            {publishedLabel && <><span>·</span><span className="inline-flex items-center gap-1"><Clock className="size-3" />{publishedLabel}</span></>}
            {ageLabel && <><span>·</span><span>{ageLabel}</span></>}
            <span>·</span><span>{h.source}</span>
            {trend && (
              <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: `color-mix(in oklab, ${trend.color} 14%, white)`, color: trend.color }}>
                <TrendingUp className="size-3" /> {trend.label}
              </span>
            )}
          </div>
        </div>

        {h.description && <p className="text-xs text-muted-foreground line-clamp-2">{h.description}</p>}

        {/* Classification */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill color="oklch(0.55 0.22 295)">{h.category}</Pill>
          <Pill color={sentimentColor(h.sentiment)}>{h.sentiment}</Pill>
          <Pill color="oklch(0.55 0.03 275)">{h.contentLabel}</Pill>
        </div>

        {/* Threat score cards */}
        <div className="grid grid-cols-5 gap-1.5">
          <ScoreCard label="Threat" value={h.threatScore} accent={sev} />
          <ScoreCard label="Reput." value={h.reputationRisk} accent="oklch(0.63 0.24 25)" />
          <ScoreCard label="Copyright" value={h.copyrightRisk} accent="oklch(0.55 0.22 295)" />
          <ScoreCard label="Credib." value={h.credibilityScore} accent="oklch(0.45 0.15 275)" />
          <ScoreCard label="Confid." value={h.confidence} accent="oklch(0.45 0.18 200)" />
        </div>

        {/* Engagement */}
        {m && (m.views || m.likes || m.comments) ? (
          <div className="grid grid-cols-4 gap-1.5 pt-1">
            <Stat icon={<Eye className="size-3" />} label="Views" value={fmt(m.views ?? 0)} />
            <Stat icon={<TrendingUp className="size-3" />} label="Likes" value={fmt(m.likes ?? 0)} />
            <Stat icon={<MessageCircle className="size-3" />} label="Comments" value={fmt(m.comments ?? 0)} />
            <Stat icon={<Flame className="size-3" />} label="Growth/day" value={fmt(m.growthPerDay ?? 0)} />
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5 pt-1">
            <Stat icon={<Users className="size-3" />} label="Reach" value={`~${fmt(h.reachEstimate)}`} />
            <Stat icon={<TrendingUp className="size-3" />} label="Engagement" value={fmt(h.engagement)} />
            <Stat icon={<Flame className="size-3" />} label="Virality" value={`${h.viralityScore}`} />
          </div>
        )}

        <div className="text-[11px] rounded-lg px-3 py-2 border border-dashed border-border bg-muted/40">
          <span className="font-semibold text-foreground">Recommended:</span> {h.recommendedAction}
        </div>

        {isYouTube && h.media?.videoId && (
          <div className="flex items-center justify-between gap-2 -mt-1">
            <ExactMomentsSummaryChips videoId={h.media.videoId} />
            {analysisPending && <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> analyzing…</span>}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 mt-auto flex-wrap">
          <button onClick={() => setOpen((v) => !v)} className="flex-1 text-xs px-3 py-2 rounded-lg border border-border hover:bg-accent inline-flex items-center justify-center gap-1">
            <ExternalLink className="size-3.5" /> {open ? "Hide" : "View"} evidence
          </button>
          {isYouTube && h.media?.videoId && (
            <button onClick={() => setMoments((v) => !v)} className="flex-1 text-xs px-3 py-2 rounded-lg border border-border hover:bg-accent inline-flex items-center justify-center gap-1">
              <Clock className="size-3.5" /> {moments ? "Hide" : "View"} exact moments
            </button>
          )}
          <button onClick={onPromote} disabled={added} className="flex-1 text-xs px-3 py-2 rounded-lg text-white font-semibold inline-flex items-center justify-center gap-1 disabled:opacity-60" style={{ background: "var(--gradient-brand)" }}>
            <ShieldPlus className="size-3.5" /> {added ? "Added" : "Send to Threat Radar"}
          </button>
        </div>

        {isYouTube && h.media?.videoId && moments && (
          <ExactMomentsPanel
            videoId={h.media.videoId}
            scanId={scanId}
            channelId={h.media.channelId ?? null}
            channelName={h.media.channelTitle ?? null}
            channelUrl={h.media.channelUrl ?? null}
            entityTerms={entityTerms}
            analysisPending={analysisPending}
          />
        )}

        {/* Evidence panel */}
        {open && (
          <div className="mt-2 rounded-xl border border-border bg-muted/30 p-4 space-y-3">
            {thumb && imgOk && (
              <a href={h.url} target="_blank" rel="noreferrer" className="block rounded-lg overflow-hidden">
                <img src={thumb} alt={displayTitle} className="w-full aspect-video object-cover" />
              </a>
            )}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Title</div>
              <div className="text-sm font-semibold">{displayTitle}</div>
            </div>
            {h.description && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Description</div>
                <div className="text-xs whitespace-pre-wrap">{h.description}</div>
              </div>
            )}
            {m && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                {m.channelTitle && <EvidenceRow label="Channel" value={m.channelUrl ? <a href={m.channelUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">{m.channelTitle}</a> : m.channelTitle} />}
                {publishedLabel && <EvidenceRow label="Published" value={publishedLabel} />}
                {m.duration && <EvidenceRow label="Duration" value={m.duration} />}
                {m.views != null && <EvidenceRow label="Views" value={fmt(m.views)} />}
                {m.likes != null && <EvidenceRow label="Likes" value={fmt(m.likes)} />}
                {m.comments != null && <EvidenceRow label="Comments" value={fmt(m.comments)} />}
                {m.engagementRate != null && <EvidenceRow label="Eng. rate" value={`${m.engagementRate}%`} />}
                {m.growthPerDay != null && <EvidenceRow label="Views/day" value={fmt(m.growthPerDay)} />}
              </div>
            )}
            {h.whyItMatters && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Why it matters</div>
                <div className="text-xs">{h.whyItMatters}</div>
              </div>
            )}
            {h.detectionReason && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Detection reason</div>
                <div className="text-xs">{h.detectionReason}</div>
              </div>
            )}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Reputation impact</div>
              <div className="text-xs">Reputation risk {h.reputationRisk}/100 · Threat {h.threatScore}/100 · Credibility {h.credibilityScore}/100 · {h.sentiment} sentiment · Category: {h.category}.</div>
            </div>
            {(h.legalTakedownPotential != null || h.copyrightEnforcementPotential != null) && (
              <div className="grid grid-cols-2 gap-2">
                {h.legalTakedownPotential != null && (
                  <div className="rounded-lg border border-dashed border-border p-2.5 bg-muted/30">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Legal Takedown Potential</div>
                    <div className="text-sm font-bold mt-0.5" style={{ color: h.legalTakedownPotential >= 70 ? "oklch(0.63 0.24 25)" : h.legalTakedownPotential >= 40 ? "oklch(0.7 0.18 55)" : "oklch(0.55 0.03 275)" }}>{h.legalTakedownPotential}/100</div>
                  </div>
                )}
                {h.copyrightEnforcementPotential != null && (
                  <div className="rounded-lg border border-dashed border-border p-2.5 bg-muted/30">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Copyright Enforcement</div>
                    <div className="text-sm font-bold mt-0.5" style={{ color: h.copyrightEnforcementPotential >= 70 ? "oklch(0.63 0.24 25)" : h.copyrightEnforcementPotential >= 40 ? "oklch(0.7 0.18 55)" : "oklch(0.55 0.03 275)" }}>{h.copyrightEnforcementPotential}/100</div>
                  </div>
                )}
              </div>
            )}
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Evidence captured {new Date(h.discoveredAt).toLocaleString()}</span>
              <a href={h.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><ExternalLink className="size-3" /> Open source</a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ScoreCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-lg border border-border p-2 text-center" style={{ background: `color-mix(in oklab, ${accent} 6%, white)` }}>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground truncate">{label}</div>
      <div className="text-sm font-bold tabular-nums" style={{ color: accent }}>{value}</div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg bg-background/60 border border-border px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">{icon}{label}</div>
      <div className="text-xs font-bold tabular-nums">{value}</div>
    </div>
  );
}

function EvidenceRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-background/60 border border-border p-2">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-xs font-semibold truncate">{value}</div>
    </div>
  );
}

/* ============================================================
   DB-backed results — cursor pagination + infinite scroll
   ============================================================ */
type PersistedHit = {
  id: string;
  scan_id: string;
  source: string;
  source_type: string | null;
  external_id: string | null;
  canonical_url: string | null;
  permalink: string | null;
  title: string | null;
  description: string | null;
  author: string | null;
  thumbnail_url: string | null;
  published_at: string | null;
  detected_at: string;
  reach: number | null;
  engagement: number | null;
  velocity: string | null;
  risk_score: number | null;
  threat_score: number | null;
  severity: string | null;
  growth_pct: number | null;
  narrative_claim: string | null;
  risk_type: string | null;
  tags: string[];
  is_new_since_last_scan: boolean;
  times_detected: number;
  first_seen_at: string;
  last_seen_at: string;
  hidden_at?: string | null;
  hidden_reason?: string | null;
};

// Source priority order — YouTube always first for reputation/defamation/impersonation impact.
const SOURCE_PRIORITY: { key: string; label: string; icon: React.ReactNode }[] = [
  { key: "YouTube", label: "YouTube", icon: <Youtube className="size-3.5" /> },
  { key: "News", label: "News", icon: <Newspaper className="size-3.5" /> },
  { key: "X", label: "X", icon: <MessageCircle className="size-3.5" /> },
  { key: "Instagram", label: "Instagram", icon: <Instagram className="size-3.5" /> },
  { key: "TikTok", label: "TikTok", icon: <Flame className="size-3.5" /> },
  { key: "Facebook", label: "Facebook", icon: <Facebook className="size-3.5" /> },
  { key: "Reddit", label: "Reddit", icon: <MessageCircle className="size-3.5" /> },
  { key: "Forums", label: "Forums", icon: <MessageCircle className="size-3.5" /> },
  { key: "Blogs", label: "Blogs", icon: <Globe className="size-3.5" /> },
  { key: "Web", label: "Websites", icon: <Globe className="size-3.5" /> },
  { key: "Reviews", label: "Reviews", icon: <Gavel className="size-3.5" /> },
  { key: "Complaints", label: "Complaints", icon: <AlertTriangle className="size-3.5" /> },
  { key: "Archive", label: "Archive", icon: <Database className="size-3.5" /> },
];
const SOURCE_RANK: Record<string, number> = Object.fromEntries(
  SOURCE_PRIORITY.map((s, i) => [s.key.toLowerCase(), i]),
);
const rankSource = (s: string | null | undefined) =>
  s ? (SOURCE_RANK[s.toLowerCase()] ?? 999) : 999;

type TimeWindow = "all" | "24h" | "7d" | "30d";
type QuickFilter = "all" | "critical" | "defamation" | "impersonation" | "deepfake" | "copyright";

function PersistedResults({
  scanId,
  summary,
  scanStatus,
}: {
  scanId: string | null;
  summary: { newHits: number; updatedHits: number; duplicatesRemoved: number; uniqueHits: number } | null;
  scanStatus: string;
}) {
  const listFn = useServerFn(listScanHits);
  const evidenceStatusFn = useServerFn(listEvidenceStatus);
  const hideFn = useServerFn(hideScanHit);
  const [items, setItems] = useState<PersistedHit[]>([]);
  const [cursor, setCursor] = useState<{ publishedAt: string | null; threatScore: number | null; id: string } | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string>("YouTube");
  const [onlyNew, setOnlyNew] = useState(false);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("all");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [hiddenFilter, setHiddenFilter] = useState<"active" | "hidden" | "all">("active");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<PersistedHit | null>(null);
  const [action, setAction] = useState<ActionTarget | null>(null);
  const [evidenceMap, setEvidenceMap] = useState<Record<string, { evidenceCount: number; status: string | null }>>({});
  const [reloadTick, setReloadTick] = useState(0);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const reqSeq = useRef(0);

  useEffect(() => {
    setItems([]); setCursor(null); setHasMore(true); setError(null); setSelected(new Set());
  }, [scanId, source, onlyNew, hiddenFilter, reloadTick]);

  const load = async (nextCursor: typeof cursor) => {
    if (loading || !hasMore) return;
    setLoading(true);
    const seq = ++reqSeq.current;
    try {
      const res = await listFn({ data: {
        scanId: scanId ?? undefined,
        source: source || undefined,
        onlyNew: onlyNew || undefined,
        hiddenFilter,
        limit: 24,
        cursor: nextCursor ?? undefined,
      } });
      if (seq !== reqSeq.current) return;
      setItems((prev) => nextCursor ? [...prev, ...(res.items as PersistedHit[])] : (res.items as PersistedHit[]));
      setCursor(res.nextCursor);
      setHasMore(!!res.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!scanId) return;
    load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanId, source, onlyNew, hiddenFilter, reloadTick]);

  useEffect(() => {
    if (!sentinel.current) return;
    const el = sentinel.current;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasMore && !loading) load(cursor);
    }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, hasMore, loading]);

  // Fetch evidence + enforcement status for currently loaded items (batched).
  useEffect(() => {
    if (!items.length) { setEvidenceMap({}); return; }
    const missing = items.map((h) => h.id).filter((id) => !(id in evidenceMap));
    if (!missing.length) return;
    let cancelled = false;
    (async () => {
      try {
        const chunks: string[][] = [];
        for (let i = 0; i < missing.length; i += 100) chunks.push(missing.slice(i, i + 100));
        for (const chunk of chunks) {
          const res = await evidenceStatusFn({ data: { scanHitIds: chunk } });
          if (cancelled) return;
          setEvidenceMap((prev) => {
            const next = { ...prev };
            for (const [id, v] of Object.entries(res.byHit)) {
              next[id] = { evidenceCount: v.evidenceCount, status: v.status };
            }
            return next;
          });
        }
      } catch {
        /* non-fatal */
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const displayItems = useMemo(() => {
    const now = Date.now();
    const windowMs =
      timeWindow === "24h" ? 86_400_000 :
      timeWindow === "7d" ? 7 * 86_400_000 :
      timeWindow === "30d" ? 30 * 86_400_000 : null;

    const matchesQuick = (h: PersistedHit) => {
      if (quickFilter === "all") return true;
      const hay = `${h.risk_type ?? ""} ${h.narrative_claim ?? ""} ${(h.tags ?? []).join(" ")} ${h.title ?? ""}`.toLowerCase();
      if (quickFilter === "critical") return (h.severity ?? "").toLowerCase() === "critical";
      if (quickFilter === "defamation") return /defam|slander|libel|false accusation/.test(hay);
      if (quickFilter === "impersonation") return /impersonat|fake account|posing/.test(hay);
      if (quickFilter === "deepfake") return /deepfake|face[- ]?swap|synthetic|ai[- ]?generated/.test(hay);
      if (quickFilter === "copyright") return /copyright|dmca|infring|unauthori[sz]ed/.test(hay);
      return true;
    };

    return items
      .filter((h) => {
        if (windowMs && h.published_at) {
          if (now - new Date(h.published_at).getTime() > windowMs) return false;
        }
        return matchesQuick(h);
      })
      .sort((a, b) => {
        const ra = rankSource(a.source);
        const rb = rankSource(b.source);
        if (ra !== rb) return ra - rb;
        const sa = SEV_RANK[a.severity ?? ""] ?? 0;
        const sb = SEV_RANK[b.severity ?? ""] ?? 0;
        if (sa !== sb) return sb - sa;
        const ta = a.threat_score ?? 0;
        const tb = b.threat_score ?? 0;
        if (ta !== tb) return tb - ta;
        const rea = a.reach ?? 0;
        const reb = b.reach ?? 0;
        if (rea !== reb) return reb - rea;
        const pa = a.published_at ? new Date(a.published_at).getTime() : 0;
        const pb = b.published_at ? new Date(b.published_at).getTime() : 0;
        return pb - pa;
      });
  }, [items, timeWindow, quickFilter]);

  const sourceCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const h of items) c[h.source] = (c[h.source] ?? 0) + 1;
    return c;
  }, [items]);
  const criticalCount = useMemo(() => items.filter((h) => (h.severity ?? "").toLowerCase() === "critical").length, [items]);
  const totalReach = useMemo(() => items.reduce((s, h) => s + (h.reach ?? 0), 0), [items]);

  const toggleSelected = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const bulkHide = async () => {
    if (!selected.size) return;
    const ids = Array.from(selected);
    try {
      await Promise.all(ids.map((id) => hideFn({ data: { scanHitId: id, reason: "bulk_hidden" } })));
      toast.success(`${ids.length} finding${ids.length === 1 ? "" : "s"} hidden`);
      clearSelection();
      setReloadTick((t) => t + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk hide failed");
    }
  };

  const bulkAction = () => {
    if (!selected.size) return;
    const ids = Array.from(selected);
    const first = items.find((h) => h.id === ids[0]);
    if (!first) return;
    // Only allow bulk enforcement when all selected share the same platform.
    const allSamePlatform = ids.every((id) => {
      const h = items.find((x) => x.id === id);
      return h && (h.source_type || h.source) === (first.source_type || first.source);
    });
    if (!allSamePlatform) {
      toast.error("Bulk action requires all selected findings to share the same platform.");
      return;
    }
    setAction({
      id: first.id,
      title: `${ids.length} selected findings on ${first.source_type || first.source}`,
      url: first.permalink ?? first.canonical_url ?? "",
      source: first.source,
      platform: first.source_type || first.source,
      threatScore: first.threat_score,
      evidenceCount: 0,
      status: null,
      author: null,
    });
  };

  if (!scanId) {
    return (
      <PageCard title="TOP YOUTUBE FINDINGS" sub="Persisting scan results…">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Saving scan and hits to the database…
        </div>
      </PageCard>
    );
  }

  const activeSource = source ? SOURCE_PRIORITY.find((s) => s.key === source) : null;
  const cardTitle = activeSource
    ? `TOP ${activeSource.label.toUpperCase()} FINDINGS`
    : "ALL RESULTS · YOUTUBE PRIORITY";
  const cardSub = activeSource
    ? `Highest-risk ${activeSource.label} content first — sorted by threat, reach, then date`
    : "Grouped in reputation-damage priority — YouTube → News → Social → Community → Archive";

  return (
    <>
    <PageCard
      title={cardTitle}
      sub={cardSub}
      actions={
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-full border border-border overflow-hidden text-[11px]">
            {(["active", "hidden", "all"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setHiddenFilter(k)}
                className={`px-3 py-1.5 ${hiddenFilter === k ? "bg-foreground text-background" : "bg-card hover:bg-accent"}`}
              >
                {k === "active" ? "Active" : k === "hidden" ? "Hidden" : "All"}
              </button>
            ))}
          </div>
          <button
            onClick={() => setOnlyNew((v) => !v)}
            className={`text-xs px-3 py-1.5 rounded-full border ${onlyNew ? "text-white border-transparent" : "border-border bg-card hover:bg-accent"}`}
            style={onlyNew ? { background: "var(--gradient-brand)" } : undefined}
          >
            New since last scan
          </button>
        </div>
      }
    >
      <div className="flex flex-wrap gap-1.5 mb-3">
        <button
          onClick={() => setSource("")}
          className={`text-[11px] px-3 py-1.5 rounded-full border inline-flex items-center gap-1.5 transition ${source === "" ? "text-white border-transparent" : "border-border bg-card hover:bg-accent"}`}
          style={source === "" ? { background: "var(--gradient-brand)" } : undefined}
        >
          All sources
        </button>
        {SOURCE_PRIORITY.map((s) => {
          const active = source === s.key;
          const count = sourceCounts[s.key] ?? 0;
          return (
            <button
              key={s.key}
              onClick={() => setSource(s.key)}
              className={`text-[11px] px-3 py-1.5 rounded-full border inline-flex items-center gap-1.5 transition ${active ? "text-white border-transparent" : "border-border bg-card hover:bg-accent"}`}
              style={active ? { background: "var(--gradient-brand)" } : undefined}
            >
              {s.icon} {s.label}
              {count > 0 && <span className={`text-[10px] font-bold ${active ? "text-white/90" : "text-muted-foreground"}`}>{count}</span>}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {([
          ["all", "All threats"],
          ["critical", "Critical only"],
          ["defamation", "Defamation"],
          ["impersonation", "Impersonation"],
          ["deepfake", "Deepfake"],
          ["copyright", "Copyright"],
        ] as [QuickFilter, string][]).map(([k, label]) => {
          const active = quickFilter === k;
          return (
            <button
              key={k}
              onClick={() => setQuickFilter(k)}
              className={`text-[11px] px-3 py-1 rounded-full border transition ${active ? "bg-foreground text-background border-transparent" : "border-border bg-card hover:bg-accent"}`}
            >
              {label}
            </button>
          );
        })}
        <span className="mx-1 text-muted-foreground/40">·</span>
        {([
          ["all", "All time"],
          ["24h", "Last 24h"],
          ["7d", "Last 7d"],
          ["30d", "Last 30d"],
        ] as [TimeWindow, string][]).map(([k, label]) => {
          const active = timeWindow === k;
          return (
            <button
              key={k}
              onClick={() => setTimeWindow(k)}
              className={`text-[11px] px-3 py-1 rounded-full border transition ${active ? "bg-foreground text-background border-transparent" : "border-border bg-card hover:bg-accent"}`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2 mb-4 text-[11px]">
        <SumChip label="YouTube" value={sourceCounts["YouTube"] ?? 0} icon={<Youtube className="size-3.5" />} />
        <SumChip label="News" value={sourceCounts["News"] ?? 0} icon={<Newspaper className="size-3.5" />} />
        <SumChip label="Social" value={(sourceCounts["Instagram"] ?? 0) + (sourceCounts["TikTok"] ?? 0) + (sourceCounts["Facebook"] ?? 0) + (sourceCounts["X"] ?? 0)} icon={<Instagram className="size-3.5" />} />
        <SumChip label="Reddit" value={sourceCounts["Reddit"] ?? 0} icon={<MessageCircle className="size-3.5" />} />
        <SumChip label="Archive" value={sourceCounts["Archive"] ?? 0} icon={<Database className="size-3.5" />} />
        <SumChip label="Critical" value={criticalCount} icon={<AlertTriangle className="size-3.5" />} />
        <SumChip label="Total reach" value={fmt(totalReach)} icon={<Users className="size-3.5" />} />
      </div>

      {error && <div className="text-xs text-red-600 mb-2">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {displayItems.map((h) => {
          const ev = evidenceMap[h.id];
          return (
            <PersistedResultCard
              key={h.id}
              hit={h as unknown as HitLike}
              selected={selected.has(h.id)}
              onToggleSelected={toggleSelected}
              onOpenDetail={(x) => setDetail(x as unknown as PersistedHit)}
              onTakeAction={(t) => setAction(t)}
              onChanged={() => { setReloadTick((t) => t + 1); setEvidenceMap((m) => { const n = { ...m }; delete n[h.id]; return n; }); }}
              evidenceCount={ev?.evidenceCount ?? 0}
              status={ev?.status ?? null}
              hiddenView={hiddenFilter === "hidden" || !!h.hidden_at}
            />
          );
        })}
      </div>

      {items.length === 0 && !loading && (
        <div className="text-xs text-muted-foreground py-6 text-center">
          {hiddenFilter === "hidden" ? "No hidden findings." : "No persisted results yet."}
        </div>
      )}

      <div ref={sentinel} className="h-8" />

      <div className="mt-2 flex items-center justify-center text-xs text-muted-foreground">
        {loading ? (
          <span className="inline-flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" /> Loading…</span>
        ) : hasMore ? (
          <button onClick={() => load(cursor)} className="px-4 py-2 rounded-full border border-border hover:bg-accent font-semibold">Load more</button>
        ) : items.length > 0 ? (
          <span>All results loaded</span>
        ) : null}
      </div>
    </PageCard>

    {selected.size > 0 && (
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 rounded-2xl border border-border bg-card shadow-2xl px-4 py-3 flex items-center gap-3">
        <span className="text-sm font-semibold">{selected.size} finding{selected.size === 1 ? "" : "s"} selected</span>
        <div className="h-5 w-px bg-border" />
        <button onClick={bulkAction} className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-accent inline-flex items-center gap-1">
          <Gavel className="size-3.5" /> Take Action
        </button>
        <button onClick={bulkHide} className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-accent inline-flex items-center gap-1 text-destructive">
          <EyeOff className="size-3.5" /> Hide
        </button>
        <button onClick={clearSelection} className="text-xs px-2 py-1.5 rounded-lg hover:bg-accent inline-flex items-center gap-1" aria-label="Clear selection">
          <XIcon className="size-3.5" />
        </button>
      </div>
    )}

    <DetailDrawer
      finding={detail as never}
      open={!!detail}
      onOpenChange={(v) => !v && setDetail(null)}
      evidenceCount={detail ? (evidenceMap[detail.id]?.evidenceCount ?? 0) : 0}
      enforcementStatus={detail ? (evidenceMap[detail.id]?.status ?? null) : null}
    />

    <ActionDrawer
      target={action}
      open={!!action}
      onOpenChange={(v) => !v && setAction(null)}
      onCreated={() => setReloadTick((t) => t + 1)}
    />
    </>
  );
}

function SumChip({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border px-2.5 py-1.5 bg-background/50 flex items-center gap-2">
      <span className="text-muted-foreground">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-[9px] uppercase tracking-wider text-muted-foreground truncate">{label}</div>
        <div className="text-xs font-semibold truncate">{value}</div>
      </div>
    </div>
  );
}
