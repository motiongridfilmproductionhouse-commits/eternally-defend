import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { scanWeb, type ScanHit, type SourceKey, type Sentiment } from "@/lib/scan.functions";
import { PageCard, Pill } from "@/components/dashboard/PageCard";
import { useData, severityColor } from "@/lib/data-store";
import {
  Radar, Search, ExternalLink, ShieldPlus, Loader2, Sparkles, TrendingUp,
  AlertTriangle, Flame, Users, Eye, Copyright, Gavel, Bell,
} from "lucide-react";

export const Route = createFileRoute("/_app/scan")({
  head: () => ({ meta: [
    { title: "Digital Intelligence — Eterna AI" },
    { name: "description", content: "Real-time cross-platform monitoring for impersonation, deepfakes, copyright abuse, and reputation threats." },
  ] }),
  component: ScanPage,
});

const SOURCES: { key: SourceKey; label: string }[] = [
  { key: "web", label: "Web" },
  { key: "reddit", label: "Reddit" },
  { key: "youtube", label: "YouTube" },
  { key: "instagram", label: "Instagram" },
  { key: "tiktok", label: "TikTok" },
  { key: "x", label: "X" },
  { key: "facebook", label: "Facebook" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "news", label: "News" },
  { key: "blogs", label: "Blogs" },
  { key: "forums", label: "Forums" },
  { key: "podcasts", label: "Podcasts" },
  { key: "archive", label: "Archive" },
];

const DEFAULT_SOURCES: SourceKey[] = ["web", "reddit", "youtube", "news", "x"];

function sentimentColor(s: Sentiment) {
  return s === "Negative" ? "oklch(0.63 0.24 25)" : s === "Positive" ? "oklch(0.68 0.16 155)" : "oklch(0.55 0.03 275)";
}

function fmt(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

function ScanPage() {
  const scan = useServerFn(scanWeb);
  const { addThreat } = useData();
  const [q, setQ] = useState("");
  const [sources, setSources] = useState<SourceKey[]>(DEFAULT_SOURCES);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [sortMode, setSortMode] = useState<"risk" | "reach" | "recent">("risk");
  const [filterSource, setFilterSource] = useState<string>("All");

  const m = useMutation({
    mutationFn: (payload: { query: string; sources: SourceKey[] }) =>
      scan({ data: { query: payload.query, limit: 8, sources: payload.sources } }),
  });

  const hits = m.data?.hits ?? [];
  const sourceLabels = useMemo(() => Array.from(new Set(hits.map((h) => h.source))), [hits]);

  const filtered = useMemo(() => {
    let list = filterSource === "All" ? hits : hits.filter((h) => h.source === filterSource);
    if (sortMode === "reach") list = [...list].sort((a, b) => b.reachEstimate - a.reachEstimate);
    else if (sortMode === "recent") list = [...list].sort((a, b) => (b.published ?? "").localeCompare(a.published ?? ""));
    else list = [...list].sort((a, b) => b.riskScore - a.riskScore);
    return list;
  }, [hits, filterSource, sortMode]);

  const critical = hits.filter((h) => h.severity === "Critical").length;
  const viral = hits.filter((h) => h.viral).length;
  const negative = hits.filter((h) => h.sentiment === "Negative").length;
  const avgRisk = hits.length ? Math.round(hits.reduce((a, h) => a + h.riskScore, 0) / hits.length) : 0;

  const toggleSource = (s: SourceKey) => {
    setSources((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim() || m.isPending) return;
    setAdded(new Set());
    setFilterSource("All");
    m.mutate({ query: q.trim(), sources: sources.length ? sources : DEFAULT_SOURCES });
  };

  const promote = (h: ScanHit) => {
    const cat = (["Deepfake","Impersonation","Copyright","News Attack","Unauthorized Ad","Viral"] as const).includes(h.category as never)
      ? (h.category as "Deepfake"|"Impersonation"|"Copyright"|"News Attack"|"Unauthorized Ad"|"Viral")
      : "Copyright";
    addThreat({
      title: h.title.slice(0, 80),
      category: cat,
      platform: h.platform,
      severity: h.severity,
      location: h.source,
      confidence: h.confidence,
    });
    setAdded((s) => new Set(s).add(h.url));
  };

  return (
    <div className="space-y-6">
      {/* Hero search */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card">
        <div className="absolute inset-0 pointer-events-none opacity-70"
          style={{ background: "radial-gradient(600px 200px at 10% 0%, oklch(0.85 0.18 295 / 0.35), transparent 60%), radial-gradient(500px 220px at 90% 100%, oklch(0.85 0.18 320 / 0.35), transparent 60%)" }} />
        <div className="relative p-6 md:p-8">
          <div className="flex items-center gap-2 text-[10px] tracking-[0.2em] font-semibold text-muted-foreground">
            <Sparkles className="size-3.5" /> DIGITAL INTELLIGENCE ENGINE
          </div>
          <h1 className="mt-2 text-2xl md:text-3xl font-display font-bold leading-tight">
            Scan the open web for <span className="text-gradient-brand">threats, leaks & impersonation</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Real-time discovery across YouTube, Reddit, X, Instagram, TikTok, news, blogs, forums and archives.
          </p>

          <form onSubmit={submit} className="mt-5 flex flex-col md:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder='Name, brand, handle, hashtag, URL (e.g. "Eterna AI deepfake")'
                className="w-full pl-10 pr-3 py-3 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
              />
            </div>
            <button
              type="submit"
              disabled={m.isPending || !q.trim()}
              className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-white text-sm font-semibold disabled:opacity-60 shadow-lg"
              style={{ background: "var(--gradient-brand)", boxShadow: "var(--shadow-elev)" }}
            >
              {m.isPending ? <Loader2 className="size-4 animate-spin" /> : <Radar className="size-4" />}
              {m.isPending ? "Scanning..." : "Run Intelligence Scan"}
            </button>
          </form>

          <div className="mt-4 flex flex-wrap gap-1.5">
            {SOURCES.map((s) => {
              const on = sources.includes(s.key);
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => toggleSource(s.key)}
                  className={`text-[11px] px-3 py-1.5 rounded-full border transition ${on ? "text-white border-transparent" : "border-border bg-card hover:bg-accent"}`}
                  style={on ? { background: "var(--gradient-brand)" } : undefined}
                >
                  {s.label}
                </button>
              );
            })}
          </div>

          {m.data?.error && (
            <div className="mt-4 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              Scan error: {m.data.error}
            </div>
          )}
        </div>
      </div>

      {/* Alerts strip */}
      {(critical > 0 || viral > 0) && (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 overflow-x-auto">
          <Bell className="size-4 text-primary shrink-0" />
          {critical > 0 && (
            <span className="text-xs font-medium flex items-center gap-1.5 whitespace-nowrap">
              <AlertTriangle className="size-3.5" style={{ color: "oklch(0.63 0.24 25)" }} />
              <b>{critical}</b> critical threats detected
            </span>
          )}
          {viral > 0 && (
            <span className="text-xs font-medium flex items-center gap-1.5 whitespace-nowrap">
              <Flame className="size-3.5" style={{ color: "oklch(0.7 0.2 35)" }} /> <b>{viral}</b> going viral
            </span>
          )}
          {negative > 0 && (
            <span className="text-xs font-medium flex items-center gap-1.5 whitespace-nowrap">
              <TrendingUp className="size-3.5" style={{ color: "oklch(0.63 0.24 25)" }} /> <b>{negative}</b> negative sentiment
            </span>
          )}
        </div>
      )}

      {/* Stat gradient cards */}
      {m.data && hits.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <GradientStat label="TOTAL DISCOVERIES" value={hits.length} sub="Across all sources" tone="brand" icon={<Eye className="size-4" />} />
          <GradientStat label="CRITICAL RISK" value={critical} sub="Immediate action" tone="danger" icon={<AlertTriangle className="size-4" />} />
          <GradientStat label="AVG RISK SCORE" value={`${avgRisk}`} sub="Weighted by AI" tone="warn" icon={<Radar className="size-4" />} />
          <GradientStat label="VIRAL SIGNALS" value={viral} sub="Trending fast" tone="viral" icon={<Flame className="size-4" />} />
        </div>
      )}

      {/* Results */}
      {hits.length > 0 && (
        <PageCard
          title="INTELLIGENCE FEED"
          sub="Ranked by AI risk score · promote any item into Threat Radar"
          actions={
            <div className="flex items-center gap-2 flex-wrap">
              <select value={filterSource} onChange={(e) => setFilterSource(e.target.value)} className="text-xs px-3 py-1.5 rounded-full border border-border bg-card">
                <option>All</option>
                {sourceLabels.map((s) => <option key={s}>{s}</option>)}
              </select>
              <div className="flex rounded-full border border-border overflow-hidden text-xs">
                {(["risk","reach","recent"] as const).map((k) => (
                  <button key={k} onClick={() => setSortMode(k)} className={`px-3 py-1.5 ${sortMode === k ? "text-white" : "bg-card hover:bg-accent"}`} style={sortMode === k ? { background: "var(--gradient-brand)" } : undefined}>
                    {k === "risk" ? "Risk" : k === "reach" ? "Reach" : "Recent"}
                  </button>
                ))}
              </div>
            </div>
          }
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filtered.map((h) => (
              <ResultCard key={h.url} h={h} added={added.has(h.url)} onPromote={() => promote(h)} />
            ))}
          </div>
        </PageCard>
      )}

      {!m.data && !m.isPending && (
        <PageCard title="HOW IT WORKS" sub="Powered by Firecrawl + Eterna AI risk model">
          <ol className="text-sm text-muted-foreground space-y-2 list-decimal pl-5">
            <li>Pick the sources you want to monitor (Reddit, YouTube, News, X, and more).</li>
            <li>Enter a person, brand, handle, hashtag or URL.</li>
            <li>Eterna AI runs parallel searches, classifies each hit for copyright risk, reputation risk, and sentiment, then ranks the feed.</li>
            <li>Promote high-risk hits into the Threat Radar to trigger DMCA, platform reports, or legal enforcement.</li>
          </ol>
        </PageCard>
      )}
    </div>
  );
}

function GradientStat({ label, value, sub, tone, icon }: { label: string; value: string | number; sub: string; tone: "brand"|"danger"|"warn"|"viral"; icon: React.ReactNode }) {
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
    <div className="rounded-2xl p-5 border border-border" style={{ background: bg }}>
      <div className="flex items-center justify-between">
        <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground">{label}</div>
        <span className="size-7 grid place-items-center rounded-full bg-white/70" style={{ color }}>{icon}</span>
      </div>
      <div className="mt-2 text-3xl font-display font-bold" style={{ color }}>{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{sub}</div>
    </div>
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
          <Radar className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="font-semibold text-foreground">{h.source}</span>
            <span>·</span>
            <span>{h.platform}</span>
            {h.published && (<><span>·</span><span>{h.published}</span></>)}
          </div>
          <a href={h.url} target="_blank" rel="noreferrer" className="block text-sm font-semibold leading-snug mt-0.5 line-clamp-2 hover:underline">
            {h.title}
          </a>
          {h.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{h.description}</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mt-3">
        <Pill color={sev}>{h.severity}</Pill>
        <Pill color="oklch(0.55 0.22 295)">{h.category}</Pill>
        <Pill color={sentimentColor(h.sentiment)}>{h.sentiment}</Pill>
      </div>

      <div className="grid grid-cols-3 gap-2 mt-3">
        <Metric icon={<Radar className="size-3" />} label="Risk" value={`${h.riskScore}`} color={sev} />
        <Metric icon={<Copyright className="size-3" />} label="Copyright" value={`${h.copyrightRisk}`} color="oklch(0.55 0.22 295)" />
        <Metric icon={<Gavel className="size-3" />} label="Reputation" value={`${h.reputationRisk}`} color="oklch(0.63 0.24 25)" />
      </div>

      <div className="flex items-center justify-between mt-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><Users className="size-3" /> Reach ~{fmt(h.reachEstimate)}</span>
        <span className="inline-flex items-center gap-1"><TrendingUp className="size-3" /> Engagement {fmt(h.engagement)}</span>
        <span>Conf {h.confidence}%</span>
      </div>

      <div className="mt-3 text-[11px] rounded-lg px-3 py-2 border border-dashed border-border bg-muted/40">
        <span className="font-semibold text-foreground">Recommended:</span> {h.recommendedAction}
      </div>

      <div className="flex items-center gap-2 mt-3">
        <a href={h.url} target="_blank" rel="noreferrer" className="flex-1 text-xs px-3 py-2 rounded-lg border border-border hover:bg-accent inline-flex items-center justify-center gap-1">
          <ExternalLink className="size-3.5" /> View evidence
        </a>
        <button
          onClick={onPromote}
          disabled={added}
          className="flex-1 text-xs px-3 py-2 rounded-lg text-white font-semibold inline-flex items-center justify-center gap-1 disabled:opacity-60"
          style={{ background: "var(--gradient-brand)" }}
        >
          <ShieldPlus className="size-3.5" /> {added ? "Added to Threats" : "Send to Threat Radar"}
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
