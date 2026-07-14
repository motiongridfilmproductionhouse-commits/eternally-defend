import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, Legend } from "recharts";
import { PageCard, Pill } from "@/components/dashboard/PageCard";
import { listScanHits, getThreatTrends } from "@/lib/scans.functions";
import { cleanTitle, readableFromSlug } from "@/lib/media-utils";

export const Route = createFileRoute("/_app/threat-monitoring")({
  head: () => ({ meta: [{ title: "Threat Monitoring — Eterna AI" }] }),
  component: ThreatMonitoringPage,
});

const SERIES_COLORS = [
  "oklch(0.6 0.24 295)",
  "oklch(0.63 0.24 25)",
  "oklch(0.65 0.18 240)",
  "oklch(0.68 0.16 155)",
  "oklch(0.72 0.14 70)",
];

function severityTone(sev?: string | null) {
  switch ((sev ?? "").toLowerCase()) {
    case "critical": return "oklch(0.6 0.24 25)";
    case "high": return "oklch(0.68 0.19 45)";
    case "medium": return "oklch(0.75 0.16 70)";
    case "low": return "oklch(0.68 0.16 155)";
    default: return "oklch(0.6 0.05 285)";
  }
}

function ThreatMonitoringPage() {
  const trendsFn = useServerFn(getThreatTrends);
  const listFn = useServerFn(listScanHits);

  const trends = useQuery({
    queryKey: ["threat-trends", 14],
    queryFn: () => trendsFn({ data: { days: 14 } }),
  });
  const hits = useQuery({
    queryKey: ["scan-hits", "monitoring"],
    queryFn: () => listFn({ data: { limit: 100 } }),
  });

  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const items = hits.data?.items ?? [];
    if (!q.trim()) return items;
    const needle = q.toLowerCase();
    return items.filter((h: any) =>
      (h.title ?? "").toLowerCase().includes(needle) ||
      (h.risk_type ?? "").toLowerCase().includes(needle) ||
      (h.source ?? "").toLowerCase().includes(needle),
    );
  }, [hits.data, q]);

  const types = trends.data?.types ?? [];

  return (
    <div className="space-y-5">
      <PageCard title="14-DAY THREAT TRENDS" sub={trends.data ? `${trends.data.totalHits} detections in the last 14 days` : "Detections across primary threat categories"}>
        <div className="h-64">
          {trends.isLoading ? (
            <div className="h-full grid place-items-center text-sm text-muted-foreground">Loading trends…</div>
          ) : types.length === 0 ? (
            <div className="h-full grid place-items-center text-sm text-muted-foreground">
              No detections yet — run a scan to populate trends.
            </div>
          ) : (
            <ResponsiveContainer>
              <LineChart data={trends.data?.series ?? []}>
                <CartesianGrid stroke="oklch(0.94 0.02 285)" strokeDasharray="3 3" />
                <XAxis dataKey="day" fontSize={11} stroke="oklch(0.55 0.03 275)" />
                <YAxis fontSize={11} stroke="oklch(0.55 0.03 275)" allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid oklch(0.92 0.01 285)" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {types.map((t, i) => (
                  <Line key={t} dataKey={t} stroke={SERIES_COLORS[i % SERIES_COLORS.length]} strokeWidth={2.5} dot={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </PageCard>

      <PageCard
        title="ALL DETECTIONS"
        sub="Every finding across the monitored web"
        actions={<input value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Search..." className="text-sm px-3 py-2 rounded-lg border border-border bg-card w-56 focus:outline-none focus:ring-2 focus:ring-primary/20" />}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="py-2.5 pr-4 font-medium">Title</th>
                <th className="py-2.5 pr-4 font-medium">Category</th>
                <th className="py-2.5 pr-4 font-medium">Source</th>
                <th className="py-2.5 pr-4 font-medium">Severity</th>
                <th className="py-2.5 pr-4 font-medium">Threat</th>
                <th className="py-2.5 pr-4 font-medium">Detected</th>
                <th className="py-2.5 pr-4 font-medium">Seen</th>
                <th className="py-2.5 pr-4 font-medium">Link</th>
              </tr>
            </thead>
            <tbody>
              {hits.isLoading && (
                <tr><td colSpan={8} className="py-6 text-center text-muted-foreground text-sm">Loading detections…</td></tr>
              )}
              {!hits.isLoading && list.length === 0 && (
                <tr><td colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                  No detections yet. <Link to="/scan" className="text-primary underline">Run a scan</Link> to populate this list.
                </td></tr>
              )}
              {list.map((t: any) => (
                <tr key={t.id} className="border-b border-border/60 hover:bg-accent/30">
                  <td className="py-3 pr-4 font-medium max-w-[360px] truncate">{cleanTitle(t.title, readableFromSlug(t.permalink ?? t.canonical_url))}</td>
                  <td className="py-3 pr-4 text-muted-foreground">{t.risk_type ?? "—"}</td>
                  <td className="py-3 pr-4 text-muted-foreground">{t.source}</td>
                  <td className="py-3 pr-4"><Pill color={severityTone(t.severity)}>{t.severity ?? "—"}</Pill></td>
                  <td className="py-3 pr-4 text-muted-foreground">{t.threat_score ?? "—"}</td>
                  <td className="py-3 pr-4 text-muted-foreground">
                    {t.detected_at ? new Date(t.detected_at).toLocaleString() : "—"}
                  </td>
                  <td className="py-3 pr-4 text-muted-foreground">×{t.times_detected}</td>
                  <td className="py-3 pr-4">
                    {t.permalink || t.canonical_url ? (
                      <a href={t.permalink ?? t.canonical_url} target="_blank" rel="noopener noreferrer" className="text-primary text-xs underline">Open</a>
                    ) : <span className="text-muted-foreground text-xs">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PageCard>
    </div>
  );
}
