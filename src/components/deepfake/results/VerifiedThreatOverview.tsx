import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from "recharts";
import type { FunnelChartPoint, OverviewMetrics } from "@/lib/deepfake/results-dashboard";

const METRIC_CARDS: Array<{
  key: keyof OverviewMetrics;
  label: string;
  tone: string;
}> = [
  { key: "verified_deepfakes", label: "Verified deepfakes", tone: "text-red-400 border-red-500/40 bg-red-500/10" },
  { key: "probable_deepfakes", label: "Probable deepfakes", tone: "text-orange-400 border-orange-500/40 bg-orange-500/10" },
  { key: "url_verified_pages", label: "URL-verified pages", tone: "text-cyan-300 border-cyan-500/40 bg-cyan-500/10" },
  { key: "unique_domains", label: "Unique domains", tone: "text-sky-300 border-sky-500/40 bg-sky-500/10" },
  { key: "identity_rejected", label: "Identity rejected", tone: "text-slate-300 border-slate-500/40 bg-slate-500/10" },
  { key: "url_rejected", label: "URL rejected", tone: "text-slate-400 border-slate-500/40 bg-slate-500/10" },
  { key: "crawl_failed", label: "Crawl failed", tone: "text-slate-400 border-slate-500/40 bg-slate-500/10" },
  { key: "client_visible", label: "Client-visible findings", tone: "text-blue-300 border-blue-500/40 bg-blue-500/10" },
];

const BAR_COLORS: Record<string, string> = {
  discovered: "#64748b",
  crawled: "#38bdf8",
  identity: "#60a5fa",
  evidence: "#22d3ee",
  client: "#f87171",
};

export function VerifiedThreatOverview({
  metrics,
  funnel,
}: {
  metrics: OverviewMetrics;
  funnel: FunnelChartPoint[];
}) {
  const hasChartValues = funnel.some((point) => point.value > 0);

  return (
    <section
      className="rounded-xl border border-sky-500/25 bg-[linear-gradient(160deg,rgba(8,24,48,0.96),rgba(10,18,32,0.98))] p-4 text-slate-100 shadow-[0_0_40px_rgba(30,123,255,0.08)]"
      aria-labelledby="verified-threat-overview-heading"
    >
      <div className="mb-4 flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-sky-300/80">
            Intelligence console
          </div>
          <h2
            id="verified-threat-overview-heading"
            className="mt-1 text-lg font-semibold tracking-tight text-white"
          >
            Verified Threat Intelligence
          </h2>
          <p className="mt-1 text-[12px] text-slate-400">
            Real saved metrics only — no estimated or fabricated values.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {METRIC_CARDS.map((card) => (
          <div
            key={card.key}
            className={`rounded-lg border px-3 py-2.5 ${card.tone}`}
          >
            <div className="text-[10px] uppercase tracking-[0.16em] opacity-80">
              {card.label}
            </div>
            <div className="mt-1 text-xl font-semibold tabular-nums">
              {metrics[card.key]}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          Verification funnel
        </div>
        {hasChartValues ? (
          <div className="h-52 w-full min-w-0 overflow-x-auto">
            <div className="min-w-[420px] h-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={funnel} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                  <CartesianGrid stroke="rgba(148,163,184,0.15)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: "#94a3b8", fontSize: 10 }}
                    interval={0}
                    height={48}
                    tickFormatter={(value: string) =>
                      value.replace(" candidates", "").replace(" findings", "")
                    }
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: "#94a3b8", fontSize: 10 }}
                    width={36}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(56,189,248,0.08)" }}
                    contentStyle={{
                      background: "#0b1728",
                      border: "1px solid rgba(56,189,248,0.35)",
                      borderRadius: 8,
                      color: "#e2e8f0",
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    {funnel.map((entry) => (
                      <Cell
                        key={entry.key}
                        fill={BAR_COLORS[entry.key] ?? "#38bdf8"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-slate-500">
            Funnel metrics appear once discovery diagnostics are saved.
          </p>
        )}
      </div>
    </section>
  );
}
