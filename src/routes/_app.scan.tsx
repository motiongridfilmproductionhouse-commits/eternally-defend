import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReputationReport, ScanHit, SourceKey, Sentiment } from "@/routes/api/scan";
import { PageCard, Pill } from "@/components/dashboard/PageCard";
import { severityColor } from "@/lib/data-store";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "sonner";
import { persistScan, listScanHits } from "@/lib/scans.functions";
import { analyzeYoutubeVideo } from "@/lib/video-analysis.functions";
import { ExactMomentsPanel, ExactMomentsSummaryChips } from "@/components/scan/ExactMomentsPanel";
import { cleanTitle, viaProxy, faviconUrl, hostFromUrl, readableFromSlug, youtubeThumbFromUrl, youtubeIdFromUrl } from "@/lib/media-utils";
import {
  Radar, Search, ExternalLink, ShieldPlus, Loader2, Sparkles, TrendingUp,
  AlertTriangle, Flame, Users, Eye, Copyright, Gavel, Bell, FileDown,
  Youtube, MessageCircle, Newspaper, Instagram, Facebook, Globe, ShieldAlert,
  BadgeCheck, ScanSearch, Clock, Database,
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

const PERIODS = ["Last 24 hours", "Last 7 days", "Last 30 days", "Last 90 days", "All time"];
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

async function runScan(payload: unknown): Promise<ReputationReport> {
  const r = await fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const j = await r.json();
  return j as ReputationReport;
}

function ScanPage() {
  const { session } = useSession();
  const userId = session?.user.id;
  const [q, setQ] = useState("");
  const [aliases, setAliases] = useState("");
  const [variations, setVariations] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [handles, setHandles] = useState("");
  const [site, setSite] = useState("");
  const [country, setCountry] = useState("");
  const [industry, setIndustry] = useState("");
  const [period, setPeriod] = useState("Last 30 days");
  const [sources, setSources] = useState<SourceKey[]>(DEFAULT_SOURCES);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [persistedScanId, setPersistedScanId] = useState<string | null>(null);
  const [persistSummary, setPersistSummary] = useState<{ newHits: number; updatedHits: number; duplicatesRemoved: number; uniqueHits: number } | null>(null);

  const m = useMutation({ mutationFn: runScan });
  const report = m.data;
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
      period,
      sources: sources.length ? sources : DEFAULT_SOURCES,
      limit: 8,
      youtubeTarget: 500,
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

  const exportCsv = () => {
    if (!report) return;
    const rows = [
      ["Title","URL","Platform","Source","ContentLabel","Category","Severity","Sentiment","ThreatScore","Credibility","Reach","Engagement","Published","RecommendedAction"],
      ...report.hits.map(h => [h.title, h.url, h.platform, h.source, h.contentLabel, h.category, h.severity, h.sentiment, h.threatScore, h.credibilityScore, h.reachEstimate, h.engagement, h.published ?? "", h.recommendedAction]),
    ];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `eterna-report-${Date.now()}.csv`; a.click(); URL.revokeObjectURL(url);
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
            <Field label="Search period">
              <select value={period} onChange={(e) => setPeriod(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-border bg-card text-sm">
                {PERIODS.map(p => <option key={p}>{p}</option>)}
              </select>
            </Field>
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
          {report?.error && <div className="mt-4 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">Scan warning: {report.error}</div>}
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
                <button onClick={exportCsv} className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-accent inline-flex items-center gap-1.5"><FileDown className="size-3.5" /> Export CSV</button>
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
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KPI label="Total unique" value={report.totals.unique} icon={<Eye className="size-4" />} tone="brand" />
            <KPI label="Critical" value={report.totals.critical} icon={<AlertTriangle className="size-4" />} tone="danger" />
            <KPI label="High" value={report.totals.high} icon={<ShieldAlert className="size-4" />} tone="warn" />
            <KPI label="Viral" value={report.totals.viral} icon={<Flame className="size-4" />} tone="viral" />
            <KPI label="Reach" value={fmt(report.totals.totalReach)} icon={<Users className="size-4" />} tone="brand" />
          </div>

          {/* DB-backed persisted results with cursor-paginated infinite scroll */}
          <PersistedResults scanId={persistedScanId} summary={persistSummary} scanStatus={report ? "completed" : "running"} />

          {(() => null)()}

          {/* Buckets */}

          {/* YouTube-first ordering: reputation damage typically starts on YouTube, then spreads to News, Reddit, and other social platforms. */}
          <Bucket title="LATEST YOUTUBE THREATS" icon={<Youtube className="size-4" />} hits={report.buckets.youtube} onPromote={promote} added={added} entityTerms={entityTerms} scanId={persistedScanId} analyzingVideos={analyzingVideos} />
          <Bucket title="CRITICAL THREATS" icon={<AlertTriangle className="size-4" />} hits={report.buckets.critical} onPromote={promote} added={added} entityTerms={entityTerms} scanId={persistedScanId} analyzingVideos={analyzingVideos} />
          <Bucket title="HIGH-PRIORITY NEGATIVE CONTENT" icon={<ShieldAlert className="size-4" />} hits={report.buckets.high} onPromote={promote} added={added} entityTerms={entityTerms} scanId={persistedScanId} analyzingVideos={analyzingVideos} />
          <Bucket title="EMERGING THREATS" icon={<TrendingUp className="size-4" />} hits={report.buckets.emerging} onPromote={promote} added={added} entityTerms={entityTerms} scanId={persistedScanId} analyzingVideos={analyzingVideos} />
          <Bucket title="NEWS COVERAGE" icon={<Newspaper className="size-4" />} hits={report.buckets.news} onPromote={promote} added={added} entityTerms={entityTerms} scanId={persistedScanId} analyzingVideos={analyzingVideos} />
          <Bucket title="REDDIT DISCUSSIONS" icon={<MessageCircle className="size-4" />} hits={report.buckets.reddit} onPromote={promote} added={added} entityTerms={entityTerms} scanId={persistedScanId} analyzingVideos={analyzingVideos} />
          <Bucket title="INSTAGRAM MONITORING" icon={<Instagram className="size-4" />} hits={report.buckets.instagram} onPromote={promote} added={added} entityTerms={entityTerms} scanId={persistedScanId} analyzingVideos={analyzingVideos} />
          <Bucket title="FACEBOOK MONITORING" icon={<Facebook className="size-4" />} hits={report.buckets.facebook} onPromote={promote} added={added} entityTerms={entityTerms} scanId={persistedScanId} analyzingVideos={analyzingVideos} />
          <Bucket title="IMPERSONATION" icon={<BadgeCheck className="size-4" />} hits={report.buckets.impersonation} onPromote={promote} added={added} entityTerms={entityTerms} scanId={persistedScanId} analyzingVideos={analyzingVideos} />
          <Bucket title="DEEPFAKE / MANIPULATED MEDIA" icon={<ShieldAlert className="size-4" />} hits={report.buckets.deepfake} onPromote={promote} added={added} entityTerms={entityTerms} scanId={persistedScanId} analyzingVideos={analyzingVideos} />
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

function Bucket({ title, icon, hits, onPromote, added, entityTerms, scanId, analyzingVideos }: { title: string; icon: React.ReactNode; hits: ScanHit[]; onPromote: (h: ScanHit) => void; added: Set<string>; entityTerms: string[]; scanId: string | null; analyzingVideos: Set<string> }) {
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
  return (
    <PageCard
      title={title}
      sub={`${filtered.length} of ${hits.length} result${hits.length === 1 ? "" : "s"}`}
      actions={
        <div className="flex items-center gap-2 flex-wrap">
          <select value={sentimentFilter} onChange={(e) => setSentimentFilter(e.target.value)} className="text-xs px-3 py-1.5 rounded-full border border-border bg-card">
            <option>All</option><option>Negative</option><option>Neutral</option><option>Positive</option>
          </select>
          <select value={sort} onChange={(e) => { setSort(e.target.value as SortKey); setVisible(PAGE_SIZE); }} className="text-xs px-3 py-1.5 rounded-full border border-border bg-card">
            {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
          </select>
        </div>
      }
    >
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground mb-2"><span className="opacity-60">{icon}</span></div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {shown.map((h) => <ResultCard key={h.id + h.url} h={h} added={added.has(h.url)} onPromote={() => onPromote(h)} entityTerms={entityTerms} scanId={scanId} analysisPending={!!(h.media?.videoId && analyzingVideos.has(h.media.videoId))} />)}
      </div>
      {filtered.length > visible && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={() => setVisible((v) => v + PAGE_SIZE)}
            className="text-xs px-4 py-2 rounded-full border border-border hover:bg-accent font-semibold"
          >
            Load more · {filtered.length - visible} remaining
          </button>
        </div>
      )}
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
  const [items, setItems] = useState<PersistedHit[]>([]);
  const [cursor, setCursor] = useState<{ publishedAt: string | null; threatScore: number | null; id: string } | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Default view: YouTube-first. Client sees "Top YouTube Findings" immediately after a scan completes.
  const [source, setSource] = useState<string>("YouTube");
  const [onlyNew, setOnlyNew] = useState(false);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("all");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const sentinel = useRef<HTMLDivElement | null>(null);
  const reqSeq = useRef(0);

  useEffect(() => {
    setItems([]); setCursor(null); setHasMore(true); setError(null);
  }, [scanId, source, onlyNew]);

  const load = async (nextCursor: typeof cursor) => {
    if (loading || !hasMore) return;
    setLoading(true);
    const seq = ++reqSeq.current;
    try {
      const res = await listFn({ data: {
        scanId: scanId ?? undefined,
        source: source || undefined,
        onlyNew: onlyNew || undefined,
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
  }, [scanId, source, onlyNew]);

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

  // Client-side filter + priority-first sort. YouTube always surfaces before Archive.
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
    <PageCard
      title={cardTitle}
      sub={cardSub}
      actions={
        <div className="flex items-center gap-2 flex-wrap">
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
      {/* Priority-ordered source chips — YouTube first, always. */}
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

      {/* Quick threat-type filters + time window */}
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

      {/* Priority-ordered summary header */}
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
          const linkUrl = h.permalink ?? h.canonical_url ?? "#";
          const displayTitle = cleanTitle(h.title, readableFromSlug(linkUrl));
          const isYT = h.source === "YouTube";
          const thumb = viaProxy(h.thumbnail_url) ?? (isYT ? youtubeThumbFromUrl(linkUrl, "hq") : null);
          const host = hostFromUrl(linkUrl);
          const favicon = faviconUrl(linkUrl);
          return (
          <a
            key={h.id}
            href={linkUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-border bg-card overflow-hidden hover:shadow-md transition flex flex-col"
          >
            {thumb ? (
              <div className="aspect-video bg-muted overflow-hidden">
                <img src={thumb} alt={displayTitle} loading="lazy" className="w-full h-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
              </div>
            ) : (
              <div className="aspect-video bg-gradient-to-br from-muted/60 to-secondary/60 flex flex-col items-center justify-center gap-1.5">
                {favicon ? <img src={favicon} alt="" className="size-8 rounded bg-white/80 p-1 shadow-sm" /> : <Globe className="size-5 text-muted-foreground" />}
                <div className="text-[10px] font-semibold text-foreground/80 truncate max-w-[80%] text-center">{host ?? h.source}</div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{h.source}</div>
              </div>
            )}
            <div className="p-3 flex-1 flex flex-col">
              <div className="flex items-center gap-1.5 mb-1">
                {h.is_new_since_last_scan && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500 text-white">NEW</span>}
                {h.severity && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded text-white" style={{ background: severityColor(h.severity as never) }}>
                    {h.severity.toUpperCase()}
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground truncate">{h.source}</span>
                {h.published_at && (
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    {new Date(h.published_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                )}
              </div>
              <div className="text-sm font-semibold line-clamp-2">{displayTitle}</div>
              {h.description && <div className="text-[11px] text-muted-foreground line-clamp-2 mt-1">{h.description}</div>}
              <div className="mt-auto pt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
                {typeof h.threat_score === "number" && <span>Threat {Math.round(h.threat_score)}</span>}
                {typeof h.reach === "number" && h.reach > 0 && <span>Reach {fmt(h.reach)}</span>}
                {h.times_detected > 1 && <span>Seen ×{h.times_detected}</span>}
              </div>
            </div>
          </a>
          );
        })}
      </div>

      {items.length === 0 && !loading && (
        <div className="text-xs text-muted-foreground py-6 text-center">No persisted results yet.</div>
      )}

      {/* Sentinel */}
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
