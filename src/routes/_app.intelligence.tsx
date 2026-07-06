import { createFileRoute } from "@tanstack/react-router";
import { PageCard, StatCard } from "@/components/dashboard/PageCard";
import { Bar, BarChart, CartesianGrid, PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Brain, Zap, Eye, TrendingUp } from "lucide-react";

export const Route = createFileRoute("/_app/intelligence")({
  head: () => ({ meta: [{ title: "Intelligence — Eterna AI" }] }),
  component: IntelligencePage,
});

const radar = [
  { area: "Deepfake", value: 92 },
  { area: "Impersonation", value: 76 },
  { area: "Copyright", value: 64 },
  { area: "News", value: 58 },
  { area: "Ads", value: 71 },
  { area: "Viral", value: 83 },
];

const platforms = [
  { name: "YouTube", findings: 67 },
  { name: "Instagram", findings: 32 },
  { name: "TikTok", findings: 18 },
  { name: "Reddit", findings: 15 },
  { name: "News", findings: 24 },
  { name: "X", findings: 11 },
];

const insights = [
  { icon: Zap, title: "Surge predicted", body: "Deepfake spread likely to grow +18% next 7 days across YouTube.", tone: "oklch(0.63 0.24 25)" },
  { icon: Eye, title: "Coordinated behavior", body: "Impersonation cluster of 6 accounts detected on Instagram from IN region.", tone: "oklch(0.7 0.2 35)" },
  { icon: TrendingUp, title: "Sentiment rising", body: "Positive sentiment +6% after last takedown wave.", tone: "oklch(0.68 0.16 155)" },
  { icon: Brain, title: "Model updated", body: "Voice-match classifier v4 improved accuracy by 3.1%.", tone: "oklch(0.55 0.22 295)" },
];

function IntelligencePage() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="AI CONFIDENCE" value="92%" sub="Overall classifier accuracy" />
        <StatCard label="MODELS ACTIVE" value="14" sub="Detection & scoring models" accent="oklch(0.68 0.16 155)" />
        <StatCard label="SIGNALS / DAY" value="182k" sub="Web + social ingest" accent="oklch(0.65 0.18 240)" />
        <StatCard label="FORECAST RISK" value="Medium" sub="Next 7 days" accent="oklch(0.75 0.16 70)" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <PageCard title="THREAT SURFACE RADAR" sub="Where risk is concentrated">
          <div className="h-72">
            <ResponsiveContainer>
              <RadarChart data={radar} outerRadius={100}>
                <PolarGrid stroke="oklch(0.92 0.01 285)" />
                <PolarAngleAxis dataKey="area" fontSize={11} stroke="oklch(0.35 0.03 275)" />
                <Radar dataKey="value" stroke="oklch(0.55 0.22 295)" fill="oklch(0.55 0.22 295)" fillOpacity={0.35} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </PageCard>

        <PageCard title="PLATFORM DISTRIBUTION" sub="Findings by platform">
          <div className="h-72">
            <ResponsiveContainer>
              <BarChart data={platforms}>
                <CartesianGrid stroke="oklch(0.94 0.02 285)" strokeDasharray="3 3" />
                <XAxis dataKey="name" fontSize={11} stroke="oklch(0.55 0.03 275)" />
                <YAxis fontSize={11} stroke="oklch(0.55 0.03 275)" />
                <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid oklch(0.92 0.01 285)" }} />
                <Bar dataKey="findings" fill="url(#barGrad)" radius={[8,8,0,0]} />
                <defs>
                  <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.6 0.24 295)" />
                    <stop offset="100%" stopColor="oklch(0.7 0.2 320)" />
                  </linearGradient>
                </defs>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </PageCard>
      </div>

      <PageCard title="AI INSIGHTS" sub="Automated observations from Eterna AI">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {insights.map((i) => {
            const Icon = i.icon;
            return (
              <div key={i.title} className="border border-border rounded-xl p-4 flex gap-3">
                <div className="size-10 rounded-xl grid place-items-center shrink-0" style={{ background: `color-mix(in oklab, ${i.tone} 14%, white)`, color: i.tone }}>
                  <Icon className="size-5" />
                </div>
                <div>
                  <div className="font-semibold text-sm">{i.title}</div>
                  <div className="text-xs text-muted-foreground mt-1">{i.body}</div>
                </div>
              </div>
            );
          })}
        </div>
      </PageCard>
    </div>
  );
}
