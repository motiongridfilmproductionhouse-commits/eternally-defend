import { createFileRoute } from "@tanstack/react-router";
import { useData, severityColor, type Status } from "@/lib/data-store";
import { PageCard, Pill } from "@/components/dashboard/PageCard";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { useState } from "react";

export const Route = createFileRoute("/_app/threat-monitoring")({
  head: () => ({ meta: [{ title: "Threat Monitoring — Eterna AI" }] }),
  component: ThreatMonitoringPage,
});

const trend = Array.from({ length: 14 }, (_, i) => ({
  day: `D${i + 1}`,
  Deepfake: 3 + Math.round(Math.sin(i / 2) * 3 + i / 2),
  Impersonation: 2 + Math.round(Math.cos(i / 3) * 2 + i / 3),
  Copyright: 1 + Math.round(Math.sin(i / 4) * 2 + i / 4),
}));

function ThreatMonitoringPage() {
  const { threats, updateThreatStatus } = useData();
  const [q, setQ] = useState("");
  const list = threats.filter((t) => t.title.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-5">
      <PageCard title="14-DAY THREAT TRENDS" sub="Detections across primary threat categories">
        <div className="h-64">
          <ResponsiveContainer>
            <LineChart data={trend}>
              <CartesianGrid stroke="oklch(0.94 0.02 285)" strokeDasharray="3 3" />
              <XAxis dataKey="day" fontSize={11} stroke="oklch(0.55 0.03 275)" />
              <YAxis fontSize={11} stroke="oklch(0.55 0.03 275)" />
              <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid oklch(0.92 0.01 285)" }} />
              <Line dataKey="Deepfake" stroke="oklch(0.6 0.24 295)" strokeWidth={2.5} dot={false} />
              <Line dataKey="Impersonation" stroke="oklch(0.63 0.24 25)" strokeWidth={2.5} dot={false} />
              <Line dataKey="Copyright" stroke="oklch(0.65 0.18 240)" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
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
                <th className="py-2.5 pr-4 font-medium">ID</th>
                <th className="py-2.5 pr-4 font-medium">Title</th>
                <th className="py-2.5 pr-4 font-medium">Category</th>
                <th className="py-2.5 pr-4 font-medium">Platform</th>
                <th className="py-2.5 pr-4 font-medium">Severity</th>
                <th className="py-2.5 pr-4 font-medium">Detected</th>
                <th className="py-2.5 pr-4 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id} className="border-b border-border/60 hover:bg-accent/30">
                  <td className="py-3 pr-4 font-mono text-xs text-muted-foreground">{t.id}</td>
                  <td className="py-3 pr-4 font-medium">{t.title}</td>
                  <td className="py-3 pr-4 text-muted-foreground">{t.category}</td>
                  <td className="py-3 pr-4 text-muted-foreground">{t.platform}</td>
                  <td className="py-3 pr-4"><Pill color={severityColor(t.severity)}>{t.severity}</Pill></td>
                  <td className="py-3 pr-4 text-muted-foreground">{t.detected}</td>
                  <td className="py-3 pr-4">
                    <select value={t.status} onChange={(e)=>updateThreatStatus(t.id, e.target.value as Status)} className="text-xs px-2 py-1 rounded-md border border-border bg-card">
                      {["Detected","In Review","Takedown Sent","Resolved"].map(s=><option key={s}>{s}</option>)}
                    </select>
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
