import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { scanWeb, type ScanHit } from "@/lib/scan.functions";
import { PageCard, Pill, StatCard } from "@/components/dashboard/PageCard";
import { useData, severityColor } from "@/lib/data-store";
import { Radar, Search, ExternalLink, ShieldPlus, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_app/scan")({
  head: () => ({ meta: [
    { title: "Web Scan — Eterna AI" },
    { name: "description", content: "Live Firecrawl-powered web scan for unauthorized content, impersonation, and copyright abuse." },
  ] }),
  component: ScanPage,
});

function ScanPage() {
  const scan = useServerFn(scanWeb);
  const { addThreat } = useData();
  const [q, setQ] = useState("");
  const [added, setAdded] = useState<Set<string>>(new Set());

  const m = useMutation({
    mutationFn: (query: string) => scan({ data: { query, limit: 12 } }),
  });

  const hits: ScanHit[] = m.data?.hits ?? [];
  const critical = hits.filter((h) => h.severity === "Critical").length;
  const high = hits.filter((h) => h.severity === "High").length;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim() || m.isPending) return;
    setAdded(new Set());
    m.mutate(q.trim());
  };

  const promote = (h: ScanHit) => {
    addThreat({
      title: h.title.slice(0, 80),
      category: h.category,
      platform: h.platform,
      severity: h.severity,
      location: "Web",
      confidence: h.confidence,
    });
    setAdded((s) => new Set(s).add(h.url));
  };

  return (
    <div className="space-y-5">
      <PageCard
        title="LIVE WEB SCAN"
        sub="Firecrawl-powered discovery across the open web"
      >
        <form onSubmit={submit} className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder='Scan for a brand, name, keyword, or URL (e.g. "Eterna AI deepfake")'
              className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <button
            type="submit"
            disabled={m.isPending || !q.trim()}
            className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-white text-sm font-semibold disabled:opacity-60"
            style={{ background: "var(--gradient-brand)" }}
          >
            {m.isPending ? <Loader2 className="size-4 animate-spin" /> : <Radar className="size-4" />}
            {m.isPending ? "Scanning..." : "Run Scan"}
          </button>
        </form>
        {m.data?.error && (
          <div className="mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            Scan error: {m.data.error}
          </div>
        )}
        {m.error && (
          <div className="mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {(m.error as Error).message}
          </div>
        )}
      </PageCard>

      {m.data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="RESULTS" value={hits.length} sub="Pages discovered" />
          <StatCard label="CRITICAL" value={critical} accent="oklch(0.63 0.24 25)" sub="Immediate threats" />
          <StatCard label="HIGH RISK" value={high} accent="oklch(0.7 0.2 35)" sub="Warrant review" />
          <StatCard label="AVG CONFIDENCE" value={hits.length ? `${Math.round(hits.reduce((a, h) => a + h.confidence, 0) / hits.length)}%` : "—"} sub="AI classifier" />
        </div>
      )}

      {hits.length > 0 && (
        <PageCard title="SCAN RESULTS" sub="Classified by AI risk model — promote any hit into the threat radar">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {hits.map((h) => (
              <div key={h.url} className="border border-border rounded-xl p-4 flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold leading-tight line-clamp-2">{h.title}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{h.platform} · {h.category}</div>
                  </div>
                  <Pill color={severityColor(h.severity)}>{h.severity}</Pill>
                </div>
                {h.description && <div className="text-xs text-muted-foreground mt-2 line-clamp-3">{h.description}</div>}
                <div className="mt-3 h-1.5 rounded-full bg-secondary overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${h.confidence}%`, background: severityColor(h.severity) }} />
                </div>
                <div className="text-[11px] text-muted-foreground mt-1">Confidence {h.confidence}%</div>
                <div className="flex items-center gap-2 mt-3">
                  <a href={h.url} target="_blank" rel="noreferrer" className="flex-1 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-accent inline-flex items-center justify-center gap-1">
                    <ExternalLink className="size-3.5" /> Open
                  </a>
                  <button
                    onClick={() => promote(h)}
                    disabled={added.has(h.url)}
                    className="flex-1 text-xs px-3 py-1.5 rounded-lg text-white font-semibold inline-flex items-center justify-center gap-1 disabled:opacity-60"
                    style={{ background: "var(--gradient-brand)" }}
                  >
                    <ShieldPlus className="size-3.5" /> {added.has(h.url) ? "Added" : "Add to Threats"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </PageCard>
      )}

      {!m.data && !m.isPending && (
        <PageCard title="HOW IT WORKS" sub="Powered by Firecrawl web intelligence">
          <ol className="text-sm text-muted-foreground space-y-2 list-decimal pl-5">
            <li>Enter a brand, name, hashtag, or suspected URL.</li>
            <li>Eterna AI queries the live web via Firecrawl and classifies each result by risk category and severity.</li>
            <li>Promote high-risk hits into the Threat Radar to trigger enforcement workflows.</li>
          </ol>
        </PageCard>
      )}
    </div>
  );
}
