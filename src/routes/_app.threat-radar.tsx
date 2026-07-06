import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useData, severityColor, type Severity, type Status } from "@/lib/data-store";
import { PageCard, Pill, StatCard } from "@/components/dashboard/PageCard";
import { Radar as RadarIcon } from "lucide-react";

export const Route = createFileRoute("/_app/threat-radar")({
  head: () => ({ meta: [{ title: "Threat Radar — Eterna AI" }] }),
  component: ThreatRadarPage,
});

const categories = ["All","Deepfake","Impersonation","Copyright","News Attack","Unauthorized Ad","Viral"] as const;

function ThreatRadarPage() {
  const { threats, updateThreatStatus } = useData();
  const [filter, setFilter] = useState<(typeof categories)[number]>("All");
  const [sev, setSev] = useState<Severity | "All">("All");

  const list = threats.filter((t) => (filter === "All" || t.category === filter) && (sev === "All" || t.severity === sev));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="ACTIVE THREATS" value={threats.length} accent="oklch(0.63 0.24 25)" sub="Across all platforms" />
        <StatCard label="CRITICAL" value={threats.filter(t=>t.severity==="Critical").length} accent="oklch(0.63 0.24 25)" sub="Require immediate action" />
        <StatCard label="AVG CONFIDENCE" value={`${Math.round(threats.reduce((a,t)=>a+t.confidence,0)/threats.length)}%`} accent="oklch(0.55 0.22 295)" sub="AI classifier certainty" />
        <StatCard label="RESOLVED" value={threats.filter(t=>t.status==="Resolved").length} accent="oklch(0.68 0.16 155)" sub="Last 7 days" />
      </div>

      <PageCard
        title="LIVE RADAR"
        sub="Filter by category and severity"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {categories.map((c)=>(
              <button key={c} onClick={()=>setFilter(c)} className={`text-xs px-3 py-1.5 rounded-full border ${filter===c ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-accent"}`}>{c}</button>
            ))}
            <select value={sev} onChange={(e)=>setSev(e.target.value as Severity | "All")} className="text-xs px-3 py-1.5 rounded-full border border-border bg-card">
              {["All","Critical","High","Medium","Low"].map(s=><option key={s}>{s}</option>)}
            </select>
          </div>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {list.map((t) => (
            <div key={t.id} className="border border-border rounded-xl p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="size-9 rounded-lg grid place-items-center" style={{ background: `color-mix(in oklab, ${severityColor(t.severity)} 14%, white)`, color: severityColor(t.severity) }}>
                    <RadarIcon className="size-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold leading-tight">{t.title}</div>
                    <div className="text-[11px] text-muted-foreground">{t.platform} · {t.location}</div>
                  </div>
                </div>
                <Pill color={severityColor(t.severity)}>{t.severity}</Pill>
              </div>
              <div className="mt-3 h-1.5 rounded-full bg-secondary overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${t.confidence}%`, background: severityColor(t.severity) }} />
              </div>
              <div className="flex items-center justify-between mt-3 text-[11px] text-muted-foreground">
                <span>Confidence {t.confidence}%</span>
                <span>Detected {t.detected}</span>
              </div>
              <div className="flex items-center gap-2 mt-3">
                <select value={t.status} onChange={(e)=>updateThreatStatus(t.id, e.target.value as Status)} className="flex-1 text-xs px-2 py-1.5 rounded-lg border border-border bg-card">
                  {["Detected","In Review","Takedown Sent","Resolved"].map(s=><option key={s}>{s}</option>)}
                </select>
                <button className="text-xs px-3 py-1.5 rounded-lg text-white font-semibold" style={{ background: "var(--gradient-brand)" }}>Take action</button>
              </div>
            </div>
          ))}
        </div>
      </PageCard>
    </div>
  );
}
