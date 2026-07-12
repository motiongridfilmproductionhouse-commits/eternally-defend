import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { ReputationReport, ScanHit, SourceKey, Sentiment, ScanMode } from "@/routes/api/scan";
import { PageCard, Pill } from "@/components/dashboard/PageCard";
import { useData, severityColor } from "@/lib/data-store";
import {
  Radar, Search, ExternalLink, ShieldPlus, Loader2, Sparkles, TrendingUp,
  AlertTriangle, Flame, Users, Eye, Copyright, Gavel, Bell, FileDown,
  Youtube, MessageCircle, Newspaper, Instagram, Facebook, Globe, ShieldAlert,
  BadgeCheck, ScanSearch, Clock,
} from "lucide-react";

export const Route = createFileRoute("/_app/scan")({
  head: () => ({ meta: [
    { title: "Reputation Intelligence Report — Eterna AI" },
    { name: "description", content: "Evidence-based reputation intelligence across news, social, video, and forums." },
  ] }),
  component: ScanPage,
});

const SOURCES: { key: SourceKey; label: string }[] = [
  { key: "web", label: "Web" },
  { key: "news", label: "News" },
  { key: "youtube", label: "YouTube" },
  { key: "reddit", label: "Reddit" },
  { key: "x", label: "X" },
  { key: "instagram", label: "Instagram" },
  { key: "tiktok", label: "TikTok" },
  { key: "facebook", label: "Facebook" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "blogs", label: "Blogs" },
  { key: "forums", label: "Forums" },
  { key: "podcasts", label: "Podcasts" },
  { key: "reviews", label: "Reviews" },
  { key: "complaints", label: "Complaints" },
  { key: "archive", label: "Archive" },
];

const PERIODS = ["Last 24 hours", "Last 7 days", "Last 30 days", "Last 90 days", "All available history"];
const DEFAULT_SOURCES: SourceKey[] = ["web", "news", "youtube", "reddit", "x", "instagram", "tiktok", "reviews", "complaints", "forums", "blogs"];
const MODES: { key: ScanMode; label: string; sub: string }[] = [
  { key: "quick", label: "Quick", sub: "~25/platform" },
  { key: "deep", label: "Deep", sub: "100+/platform" },
  { key: "investigation", label: "Investigation", sub: "up to 500/platform" },
];

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
  const { addThreat } = useData();
  const [q, setQ] = useState("");
  const [aliases, setAliases] = useState("");
  const [handles, setHandles] = useState("");
  const [site, setSite] = useState("");
  const [country, setCountry] = useState("");
  const [industry, setIndustry] = useState("");
  const [period, setPeriod] = useState("Last 30 days");
  const [sources, setSources] = useState<SourceKey[]>(DEFAULT_SOURCES);
  const [mode, setMode] = useState<ScanMode>("deep");
  const [added, setAdded] = useState<Set<string>>(new Set());

  const m = useMutation({ mutationFn: runScan });
  const report = m.data;

  const toggleSource = (s: SourceKey) => setSources((p) => p.includes(s) ? p.filter(x => x !== s) : [...p, s]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim() || m.isPending) return;
    setAdded(new Set());
    const aliasList = aliases.split(",").map(s => s.trim()).filter(Boolean);
    const handleList = handles.split(",").map(s => s.trim()).filter(Boolean);
    const context = [industry, country, site].filter(Boolean).join(" ");
    const fullQuery = `${q.trim()}${context ? " " + context : ""}`;
    m.mutate({ query: fullQuery, aliases: aliasList, handles: handleList, period, mode, sources: sources.length ? sources : DEFAULT_SOURCES });
  };

  const promote = (h: ScanHit) => {
    const cat = (["Deepfake","Impersonation","Copyright","News Attack","Unauthorized Ad","Viral"] as const).includes(h.category as never)
      ? (h.category as "Deepfake"|"Impersonation"|"Copyright"|"News Attack"|"Unauthorized Ad"|"Viral")
      : "Copyright";
    addThreat({ title: h.title.slice(0, 80), category: cat, platform: h.platform, severity: h.severity, location: h.source, confidence: h.confidence });
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

            <div className="md:col-span-2 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1 text-[10px] tracking-[0.16em] font-semibold text-muted-foreground">MODE</div>
              <div className="flex rounded-full border border-border overflow-hidden text-xs">
                {MODES.map((mm) => (
                  <button key={mm.key} type="button" onClick={() => setMode(mm.key)} className={`px-3 py-1.5 ${mode === mm.key ? "text-white" : "bg-card hover:bg-accent"}`} style={mode === mm.key ? { background: "var(--gradient-brand)" } : undefined}>
                    <span className="font-semibold">{mm.label}</span> <span className="opacity-70">· {mm.sub}</span>
                  </button>
                ))}
              </div>
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

          {/* Per-platform stats strip */}
          <PageCard title="COLLECTION STATUS" sub={`${report.mode.toUpperCase()} scan · ${report.totals.unique} unique results across ${report.platformStats.length} sources`}>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
              {report.platformStats.map((p) => {
                const pct = Math.min(100, Math.round((p.unique / Math.max(1, p.target)) * 100));
                const color = p.status === "failed" ? "oklch(0.55 0.24 25)" : p.status === "empty" ? "oklch(0.55 0.03 275)" : p.status === "partial" ? "oklch(0.7 0.18 55)" : "oklch(0.55 0.22 155)";
                return (
                  <div key={p.key} className="rounded-xl border border-border p-3 bg-card">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold">{p.label}</span>
                      <span className="text-muted-foreground">{p.unique}/{p.target}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden mt-2">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                    </div>
                    <div className="mt-1.5 text-[10px] text-muted-foreground flex justify-between">
                      <span className="uppercase tracking-wider">{p.status}</span>
                      <span>{p.queriesRun} quer{p.queriesRun === 1 ? "y" : "ies"}</span>
                    </div>
                    {p.error && <div className="mt-1 text-[10px] text-red-600 truncate" title={p.error}>{p.error}</div>}
                  </div>
                );
              })}
            </div>
          </PageCard>

          {/* Buckets */}
          <Bucket title="CRITICAL THREATS" icon={<AlertTriangle className="size-4" />} hits={report.buckets.critical} onPromote={promote} added={added} />
          <Bucket title="HIGH-PRIORITY NEGATIVE CONTENT" icon={<ShieldAlert className="size-4" />} hits={report.buckets.high} onPromote={promote} added={added} />
          <Bucket title="EMERGING THREATS" icon={<TrendingUp className="size-4" />} hits={report.buckets.emerging} onPromote={promote} added={added} />
          <Bucket title="NEWS COVERAGE" icon={<Newspaper className="size-4" />} hits={report.buckets.news} onPromote={promote} added={added} />
          <Bucket title="YOUTUBE MONITORING" icon={<Youtube className="size-4" />} hits={report.buckets.youtube} onPromote={promote} added={added} />
          <Bucket title="REDDIT MONITORING" icon={<MessageCircle className="size-4" />} hits={report.buckets.reddit} onPromote={promote} added={added} />
          <Bucket title="X / TWITTER MONITORING" icon={<MessageCircle className="size-4" />} hits={report.buckets.x} onPromote={promote} added={added} />
          <Bucket title="TIKTOK MONITORING" icon={<Flame className="size-4" />} hits={report.buckets.tiktok} onPromote={promote} added={added} />
          <Bucket title="INSTAGRAM MONITORING" icon={<Instagram className="size-4" />} hits={report.buckets.instagram} onPromote={promote} added={added} />
          <Bucket title="FACEBOOK MONITORING" icon={<Facebook className="size-4" />} hits={report.buckets.facebook} onPromote={promote} added={added} />
          <Bucket title="IMPERSONATION" icon={<BadgeCheck className="size-4" />} hits={report.buckets.impersonation} onPromote={promote} added={added} />
          <Bucket title="DEEPFAKE / MANIPULATED MEDIA" icon={<ShieldAlert className="size-4" />} hits={report.buckets.deepfake} onPromote={promote} added={added} />
          <Bucket title="REVIEWS & COMPLAINTS" icon={<Gavel className="size-4" />} hits={report.buckets.reviews} onPromote={promote} added={added} />

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

function Bucket({ title, icon, hits, onPromote, added }: { title: string; icon: React.ReactNode; hits: ScanHit[]; onPromote: (h: ScanHit) => void; added: Set<string> }) {
  const [sort, setSort] = useState<"threat"|"reach"|"recent">("threat");
  const [sentimentFilter, setSentimentFilter] = useState<string>("All");
  const filtered = useMemo(() => {
    let list = sentimentFilter === "All" ? hits : hits.filter((h) => h.sentiment === sentimentFilter);
    if (sort === "reach") list = [...list].sort((a, b) => b.reachEstimate - a.reachEstimate);
    else if (sort === "recent") list = [...list].sort((a, b) => (b.published ?? "").localeCompare(a.published ?? ""));
    else list = [...list].sort((a, b) => b.threatScore - a.threatScore);
    return list;
  }, [hits, sort, sentimentFilter]);
  if (!hits.length) return null;
  return (
    <PageCard
      title={title}
      sub={`${hits.length} result${hits.length === 1 ? "" : "s"}`}
      actions={
        <div className="flex items-center gap-2 flex-wrap">
          <select value={sentimentFilter} onChange={(e) => setSentimentFilter(e.target.value)} className="text-xs px-3 py-1.5 rounded-full border border-border bg-card">
            <option>All</option><option>Negative</option><option>Neutral</option><option>Positive</option>
          </select>
          <div className="flex rounded-full border border-border overflow-hidden text-xs">
            {(["threat","reach","recent"] as const).map((k) => (
              <button key={k} onClick={() => setSort(k)} className={`px-3 py-1.5 ${sort === k ? "text-white" : "bg-card hover:bg-accent"}`} style={sort === k ? { background: "var(--gradient-brand)" } : undefined}>
                {k === "threat" ? "Threat" : k === "reach" ? "Reach" : "Recent"}
              </button>
            ))}
          </div>
        </div>
      }
    >
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground mb-2"><span className="opacity-60">{icon}</span></div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filtered.map((h) => <ResultCard key={h.id + h.url} h={h} added={added.has(h.url)} onPromote={() => onPromote(h)} />)}
      </div>
    </PageCard>
  );
}

function ResultCard({ h, added, onPromote }: { h: ScanHit; added: boolean; onPromote: () => void }) {
  const sev = severityColor(h.severity);
  return (
    <div className="relative rounded-2xl border border-border bg-card p-4 overflow-hidden">
      {h.viral && (
        <div className="absolute top-3 right-3 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1" style={{ background: "oklch(0.94 0.1 35)", color: "oklch(0.5 0.22 35)" }}>
          <Flame className="size-3" /> VIRAL
        </div>
      )}
      <div className="flex items-start gap-3">
        <div className="size-10 rounded-xl grid place-items-center shrink-0" style={{ background: `color-mix(in oklab, ${sev} 14%, white)`, color: sev }}>
          <Globe className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
            <span className="font-semibold text-foreground">{h.source}</span>
            <span>·</span><span>{h.platform}</span>
            {h.published && (<><span>·</span><span className="inline-flex items-center gap-1"><Clock className="size-3" />{h.published}</span></>)}
          </div>
          <a href={h.url} target="_blank" rel="noreferrer" className="block text-sm font-semibold leading-snug mt-0.5 line-clamp-2 hover:underline">{h.title}</a>
          {h.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{h.description}</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mt-3">
        <Pill color={sev}>{h.severity}</Pill>
        <Pill color="oklch(0.55 0.22 295)">{h.category}</Pill>
        <Pill color={sentimentColor(h.sentiment)}>{h.sentiment}</Pill>
        <Pill color="oklch(0.55 0.03 275)">{h.contentLabel}</Pill>
      </div>

      <div className="grid grid-cols-4 gap-2 mt-3">
        <Metric icon={<Radar className="size-3" />} label="Threat" value={`${h.threatScore}`} color={sev} />
        <Metric icon={<BadgeCheck className="size-3" />} label="Credibility" value={`${h.credibilityScore}`} color="oklch(0.45 0.15 275)" />
        <Metric icon={<Copyright className="size-3" />} label="Copyright" value={`${h.copyrightRisk}`} color="oklch(0.55 0.22 295)" />
        <Metric icon={<Gavel className="size-3" />} label="Reputation" value={`${h.reputationRisk}`} color="oklch(0.63 0.24 25)" />
      </div>

      <div className="flex items-center justify-between mt-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><Users className="size-3" /> Reach ~{fmt(h.reachEstimate)}</span>
        <span className="inline-flex items-center gap-1"><TrendingUp className="size-3" /> Eng {fmt(h.engagement)}</span>
        <span>Conf {h.confidence}%</span>
      </div>

      <div className="mt-3 text-[11px] rounded-lg px-3 py-2 border border-dashed border-border bg-muted/40">
        <span className="font-semibold text-foreground">Recommended:</span> {h.recommendedAction}
      </div>

      <div className="flex items-center gap-2 mt-3">
        <a href={h.url} target="_blank" rel="noreferrer" className="flex-1 text-xs px-3 py-2 rounded-lg border border-border hover:bg-accent inline-flex items-center justify-center gap-1">
          <ExternalLink className="size-3.5" /> View evidence
        </a>
        <button onClick={onPromote} disabled={added} className="flex-1 text-xs px-3 py-2 rounded-lg text-white font-semibold inline-flex items-center justify-center gap-1 disabled:opacity-60" style={{ background: "var(--gradient-brand)" }}>
          <ShieldPlus className="size-3.5" /> {added ? "Added" : "Send to Threat Radar"}
        </button>
      </div>
    </div>
  );
}

function Metric({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground uppercase tracking-wider">
        <span style={{ color }}>{icon}</span>{label}
      </div>
      <div className="text-sm font-bold mt-0.5" style={{ color }}>{value}</div>
    </div>
  );
}
