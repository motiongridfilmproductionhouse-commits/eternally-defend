import { createFileRoute } from "@tanstack/react-router";
import { PageCard, StatCard } from "@/components/dashboard/PageCard";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, FileText } from "lucide-react";

export const Route = createFileRoute("/_app/reports")({
  head: () => ({ meta: [{ title: "Reports — Eterna AI" }] }),
  component: ReportsPage,
});

const data = Array.from({ length: 12 }, (_, i) => ({
  month: `M${i + 1}`,
  detections: 120 + Math.round(Math.sin(i) * 40 + i * 8),
  removals: 90 + Math.round(Math.cos(i) * 35 + i * 6),
}));

const templates = [
  { title: "Monthly Protection Summary", desc: "Assets, threats, takedowns, and outcomes." },
  { title: "Executive Reputation Report", desc: "Sentiment, exposure, and forecast." },
  { title: "Legal Enforcement Log", desc: "DMCA and legal actions with evidence." },
  { title: "Deepfake Intelligence Digest", desc: "AI-flagged synthetic media report." },
];

function ReportsPage() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="REPORTS GENERATED" value="164" sub="Last 12 months" />
        <StatCard label="EVIDENCE ITEMS" value="8,392" sub="Screenshots + metadata" accent="oklch(0.65 0.18 240)" />
        <StatCard label="EXPORTS" value="72" sub="PDF / CSV" accent="oklch(0.68 0.16 155)" />
        <StatCard label="SCHEDULED" value="6" sub="Recurring reports" accent="oklch(0.75 0.16 70)" />
      </div>

      <PageCard title="DETECTIONS VS REMOVALS" sub="12-month trend">
        <div className="h-72">
          <ResponsiveContainer>
            <AreaChart data={data}>
              <defs>
                <linearGradient id="det" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="oklch(0.6 0.24 295)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="oklch(0.6 0.24 295)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="rem" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="oklch(0.68 0.16 155)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="oklch(0.68 0.16 155)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="oklch(0.94 0.02 285)" strokeDasharray="3 3" />
              <XAxis dataKey="month" fontSize={11} stroke="oklch(0.55 0.03 275)" />
              <YAxis fontSize={11} stroke="oklch(0.55 0.03 275)" />
              <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid oklch(0.92 0.01 285)" }} />
              <Area type="monotone" dataKey="detections" stroke="oklch(0.6 0.24 295)" strokeWidth={2.5} fill="url(#det)" />
              <Area type="monotone" dataKey="removals" stroke="oklch(0.68 0.16 155)" strokeWidth={2.5} fill="url(#rem)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </PageCard>

      <PageCard title="REPORT TEMPLATES" sub="Generate and download">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {templates.map((t) => (
            <div key={t.title} className="border border-border rounded-xl p-4 flex items-center gap-4">
              <div className="size-11 rounded-xl grid place-items-center bg-primary/10 text-primary"><FileText className="size-5" /></div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm">{t.title}</div>
                <div className="text-xs text-muted-foreground">{t.desc}</div>
              </div>
              <button className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg text-white" style={{ background: "var(--gradient-brand)" }}>
                <Download className="size-3.5" /> Generate
              </button>
            </div>
          ))}
        </div>
      </PageCard>
    </div>
  );
}
