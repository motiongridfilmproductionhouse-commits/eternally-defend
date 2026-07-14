import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, ChevronRight, Eye, FileText, Flame,
  Globe, Loader2, PlayCircle, Radar, ShieldAlert, ShieldCheck, Sparkles, TrendingDown,
  TrendingUp, Zap, Radio, ExternalLink, Youtube, Newspaper, MessageCircle,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { getCommandCenterStats } from "@/lib/command-center.functions";

type CmdData = Awaited<ReturnType<typeof getCommandCenterStats>>;

const SEV_COLOR: Record<string, string> = {
  Critical: "oklch(0.63 0.24 25)",
  High: "oklch(0.72 0.18 55)",
  Medium: "oklch(0.78 0.15 85)",
  Low: "oklch(0.7 0.14 155)",
  Info: "oklch(0.68 0.09 240)",
};

const ZONE_STYLE: Record<string, { label: string; color: string; ring: string }> = {
  SAFE: { label: "SAFE", color: "oklch(0.7 0.16 155)", ring: "shadow-[0_0_60px_-15px_oklch(0.7_0.16_155_/_0.6)]" },
  WATCH: { label: "WATCH", color: "oklch(0.78 0.15 85)", ring: "shadow-[0_0_60px_-15px_oklch(0.78_0.15_85_/_0.6)]" },
  DANGER: { label: "DANGER", color: "oklch(0.72 0.18 55)", ring: "shadow-[0_0_60px_-15px_oklch(0.72_0.18_55_/_0.6)]" },
  CRITICAL: { label: "CRITICAL", color: "oklch(0.63 0.24 25)", ring: "shadow-[0_0_80px_-15px_oklch(0.63_0.24_25_/_0.7)] animate-pulse" },
};

function fmt(n: number | null | undefined) {
  const v = Number(n ?? 0);
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(1) + "K";
  return String(v);
}

function timeAgo(iso: string) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return `${Math.floor(d)}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

export function CommandCenter() {
  const fetchStats = useServerFn(getCommandCenterStats);
  const q = useQuery({
    queryKey: ["command-center"],
    queryFn: () => fetchStats(),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  if (q.isLoading || !q.data) {
    return (
      <div className="min-h-[60vh] grid place-items-center text-muted-foreground">
        <div className="flex items-center gap-3"><Loader2 className="size-4 animate-spin" /> Booting Command Center…</div>
      </div>
    );
  }
  if (q.error) {
    return <div className="p-6 text-danger">Failed to load intelligence: {(q.error as Error).message}</div>;
  }

  const d = q.data;

  return (
    <div className="space-y-5 relative">
      {/* deep-navy backdrop layer for command aesthetic */}
      <div className="pointer-events-none fixed inset-0 -z-10 opacity-[0.55] [background:radial-gradient(1200px_600px_at_20%_-10%,oklch(0.42_0.18_260_/_0.35),transparent_60%),radial-gradient(1000px_500px_at_100%_10%,oklch(0.55_0.22_295_/_0.25),transparent_60%),linear-gradient(180deg,oklch(0.16_0.06_260)_0%,transparent_50%)]" />

      <TopIntelBar d={d} />

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-5"><ReputationRadar d={d} /></div>
        <div className="xl:col-span-4 space-y-5">
          <DangerMeter d={d} />
          <ThreatIntelOverview d={d} />
        </div>
        <div className="xl:col-span-3"><ExecutiveSummary d={d} /></div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-5"><LiveScannerPanel d={d} /></div>
        <div className="xl:col-span-7"><ThreatHeatmap d={d} /></div>
      </div>

      <ReputationSpoilerDetector d={d} />

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-7"><TrendingThreats d={d} /></div>
        <div className="xl:col-span-5"><AssetExposurePanel d={d} /></div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-8"><ScanTimeline d={d} /></div>
        <div className="xl:col-span-4"><ActionCenter /></div>
      </div>
    </div>
  );
}

/* ---------- Shared glass card ---------- */
function Glass({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`relative rounded-2xl border border-white/10 bg-background/60 backdrop-blur-md shadow-[0_10px_40px_-15px_oklch(0.2_0.1_260_/_0.4)] ${className}`}>
      {children}
    </div>
  );
}

function CardHeader({ label, sub, action }: { label: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-4">
      <div>
        <div className="text-[10px] tracking-[0.22em] font-bold text-primary/80 uppercase">{label}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </div>
      {action}
    </div>
  );
}

/* ---------- Top intelligence bar ---------- */
function TopIntelBar({ d }: { d: CmdData }) {
  const items = [
    { label: "Reputation", value: `${d.top.reputation}/100`, tone: d.top.reputation >= 75 ? "oklch(0.7 0.16 155)" : d.top.reputation >= 50 ? "oklch(0.78 0.15 85)" : "oklch(0.63 0.24 25)", icon: ShieldCheck },
    { label: "Threat Level", value: d.top.threatLevel, tone: SEV_COLOR[d.top.threatLevel === "Safe" ? "Low" : d.top.threatLevel === "Moderate" ? "Medium" : d.top.threatLevel] ?? SEV_COLOR.Low, icon: ShieldAlert },
    { label: "Protection", value: (d.protection.level ?? "monitoring").replace(/_/g, " "), tone: "oklch(0.62 0.19 256)", icon: ShieldCheck },
    { label: "Active Scans", value: d.top.activeScans, tone: "oklch(0.65 0.18 240)", icon: Radar },
    { label: "Assets", value: d.top.protectedAssets, tone: "oklch(0.55 0.22 295)", icon: FileText },
    { label: "Critical Cases", value: d.top.criticalCases, tone: "oklch(0.63 0.24 25)", icon: Flame },
    { label: "Pending", value: d.top.pendingActions, tone: "oklch(0.78 0.15 85)", icon: Zap },
    { label: "Enforcement", value: d.top.openEnforcement, tone: "oklch(0.68 0.16 155)", icon: PlayCircle },
  ];
  return (
    <Glass className="p-4">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <div key={it.label} className="flex items-center gap-3 px-3 py-2 rounded-xl border border-white/5 bg-white/[0.02]">
              <div className="size-9 rounded-lg grid place-items-center shrink-0" style={{ background: `color-mix(in oklab, ${it.tone} 16%, transparent)`, color: it.tone }}>
                <Icon className="size-4" />
              </div>
              <div className="min-w-0">
                <div className="text-[9px] tracking-[0.18em] font-semibold uppercase text-muted-foreground truncate">{it.label}</div>
                <div className="text-sm font-bold font-display tabular-nums truncate" style={{ color: it.tone }}>{String(it.value)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </Glass>
  );
}

/* ---------- Reputation Radar ---------- */
function ReputationRadar({ d }: { d: CmdData }) {
  const [hover, setHover] = useState<CmdData["radar"][number] | null>(null);
  const size = 420;
  const cx = size / 2;
  const cy = size / 2;
  const rMax = size / 2 - 20;
  const platforms = useMemo(() => Array.from(new Set(d.radar.map((r) => r.platform))), [d.radar]);
  return (
    <Glass className="p-5 h-full">
      <CardHeader label="Reputation Radar" sub={`${d.radar.length} live threat nodes across ${platforms.length} platforms`} />
      <div className="relative grid place-items-center">
        <svg viewBox={`0 0 ${size} ${size}`} width="100%" style={{ maxWidth: size }}>
          {[0.9, 0.65, 0.4, 0.18].map((f, i) => (
            <circle key={i} cx={cx} cy={cy} r={rMax * f} fill={i === 0 ? "oklch(0.7 0.16 155 / 0.06)" : i === 1 ? "oklch(0.78 0.15 85 / 0.06)" : i === 2 ? "oklch(0.72 0.18 55 / 0.06)" : "oklch(0.63 0.24 25 / 0.08)"} stroke="oklch(0.65 0.18 240 / 0.3)" strokeDasharray="2 4" strokeWidth={1} />
          ))}
          {/* zone labels */}
          <text x={cx} y={cy - rMax * 0.94} textAnchor="middle" className="fill-[oklch(0.7_0.16_155)]" fontSize="9" fontWeight="700" letterSpacing="2">SAFE</text>
          <text x={cx} y={cy - rMax * 0.69} textAnchor="middle" className="fill-[oklch(0.78_0.15_85)]" fontSize="9" fontWeight="700" letterSpacing="2">WATCH</text>
          <text x={cx} y={cy - rMax * 0.44} textAnchor="middle" className="fill-[oklch(0.72_0.18_55)]" fontSize="9" fontWeight="700" letterSpacing="2">THREAT</text>
          <text x={cx} y={cy - rMax * 0.13} textAnchor="middle" className="fill-[oklch(0.63_0.24_25)]" fontSize="9" fontWeight="700" letterSpacing="2">CRITICAL</text>
          {/* sweep lines */}
          {platforms.map((p, i) => {
            const a = (i / Math.max(platforms.length, 1)) * Math.PI * 2 - Math.PI / 2;
            const x = cx + Math.cos(a) * rMax;
            const y = cy + Math.sin(a) * rMax;
            return <line key={p} x1={cx} y1={cy} x2={x} y2={y} stroke="oklch(0.65 0.18 240 / 0.15)" strokeWidth={1} />;
          })}
          {/* platform labels */}
          {platforms.map((p, i) => {
            const a = (i / Math.max(platforms.length, 1)) * Math.PI * 2 - Math.PI / 2;
            const x = cx + Math.cos(a) * (rMax + 12);
            const y = cy + Math.sin(a) * (rMax + 12);
            return <text key={p} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize="9" className="fill-muted-foreground" fontWeight="600">{p}</text>;
          })}
          {/* nodes */}
          {d.radar.map((n, idx) => {
            const platformIdx = platforms.indexOf(n.platform);
            const jitter = ((idx * 37) % 100) / 100 - 0.5;
            const a = (platformIdx / Math.max(platforms.length, 1)) * Math.PI * 2 - Math.PI / 2 + jitter * 0.3;
            const r = rMax * (1 - Math.min(1, Math.max(0, n.threatScore / 100))) * 0.9 + 6;
            const x = cx + Math.cos(a) * r;
            const y = cy + Math.sin(a) * r;
            const sev = n.severity[0].toUpperCase() + n.severity.slice(1).toLowerCase();
            const color = SEV_COLOR[sev] ?? SEV_COLOR.Low;
            const isCrit = sev === "Critical";
            return (
              <g key={n.id} onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(null)} className="cursor-pointer">
                <circle cx={x} cy={y} r={isCrit ? 6 : 4} fill={color} className={isCrit ? "animate-pulse" : ""} />
                <circle cx={x} cy={y} r={isCrit ? 12 : 8} fill={color} opacity={0.15} />
              </g>
            );
          })}
        </svg>
        {hover && (
          <div className="absolute top-2 left-2 max-w-[260px] rounded-lg border border-white/10 bg-background/95 backdrop-blur px-3 py-2 text-xs shadow-lg pointer-events-none">
            <div className="font-semibold truncate">{hover.title}</div>
            <div className="text-muted-foreground text-[10px] mt-0.5">{hover.platform} · {hover.severity} · Threat {Math.round(hover.threatScore)} · Reach {fmt(hover.reach)}</div>
          </div>
        )}
      </div>
      <div className="flex items-center justify-center gap-4 mt-3 text-[10px] text-muted-foreground">
        {(["Critical", "High", "Medium", "Low"] as const).map((s) => (
          <span key={s} className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: SEV_COLOR[s] }} />{s}</span>
        ))}
      </div>
    </Glass>
  );
}

/* ---------- Danger meter ---------- */
function DangerMeter({ d }: { d: CmdData }) {
  const zone = ZONE_STYLE[d.danger.zone];
  const pct = Math.max(0, Math.min(100, d.danger.score));
  return (
    <Glass className={`p-5 ${zone.ring}`}>
      <CardHeader label="Danger Meter" sub="Composite of severity, reach, velocity & criticality" />
      <div className="flex items-center gap-5">
        <div className="relative size-[130px] shrink-0">
          <svg viewBox="0 0 100 100" className="size-full -rotate-90">
            <circle cx="50" cy="50" r="42" fill="none" stroke="oklch(0.28 0.05 260)" strokeWidth="10" />
            <circle cx="50" cy="50" r="42" fill="none" stroke={zone.color} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(pct / 100) * 264} 264`} />
          </svg>
          <div className="absolute inset-0 grid place-items-center text-center">
            <div>
              <div className="text-3xl font-display font-bold tabular-nums" style={{ color: zone.color }}>{pct}</div>
              <div className="text-[9px] tracking-[0.2em] font-semibold text-muted-foreground">/100</div>
            </div>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-2xl font-display font-bold tracking-tight" style={{ color: zone.color }}>{zone.label}</div>
          <div className="text-xs text-muted-foreground mt-1">Reach {fmt(d.danger.totalReach)}</div>
          <div className="flex items-center gap-2 mt-2 text-xs">
            {d.danger.velocityDelta > 0 ? <ArrowUpRight className="size-3.5 text-danger" /> : d.danger.velocityDelta < 0 ? <ArrowDownRight className="size-3.5 text-success" /> : <Activity className="size-3.5 text-muted-foreground" />}
            <span>{d.danger.velocityDelta > 0 ? "+" : ""}{d.danger.velocityDelta} findings vs prior 24h</span>
          </div>
        </div>
      </div>
    </Glass>
  );
}

/* ---------- Threat intel overview ---------- */
function ThreatIntelOverview({ d }: { d: CmdData }) {
  const kpis = [
    { label: "Total", value: d.overview.totalFindings, trend: d.overview.findingsTrend, spark: d.overview.findingsSpark, tone: "oklch(0.65 0.18 240)" },
    { label: "Critical", value: d.overview.criticalFindings, trend: d.overview.criticalTrend, spark: d.overview.criticalSpark, tone: "oklch(0.63 0.24 25)" },
    { label: "New Today", value: d.overview.newToday, trend: "up" as const, spark: d.overview.findingsSpark, tone: "oklch(0.78 0.15 85)" },
    { label: "Escalated", value: d.overview.escalated, trend: "flat" as const, spark: d.overview.findingsSpark, tone: "oklch(0.55 0.22 295)" },
    { label: "Resolved", value: d.overview.resolved, trend: "up" as const, spark: d.overview.findingsSpark, tone: "oklch(0.7 0.16 155)" },
    { label: "False +", value: d.overview.falsePositives, trend: "flat" as const, spark: d.overview.findingsSpark, tone: "oklch(0.68 0.09 240)" },
  ];
  return (
    <Glass className="p-5">
      <CardHeader label="Threat Intelligence Overview" />
      <div className="grid grid-cols-3 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
            <div className="text-[9px] tracking-widest uppercase text-muted-foreground font-semibold">{k.label}</div>
            <div className="flex items-end justify-between mt-1">
              <div className="text-xl font-display font-bold tabular-nums" style={{ color: k.tone }}>{k.value}</div>
              {k.trend === "up" ? <TrendingUp className="size-3.5 text-danger" /> : k.trend === "down" ? <TrendingDown className="size-3.5 text-success" /> : <Activity className="size-3.5 text-muted-foreground" />}
            </div>
            <Sparkline data={k.spark.map((s) => s.v)} color={k.tone} />
          </div>
        ))}
      </div>
    </Glass>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(1, ...data);
  const w = 100, h = 20;
  const step = w / Math.max(1, data.length - 1);
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full mt-1.5" height={20}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}

/* ---------- Executive Summary ---------- */
function ExecutiveSummary({ d }: { d: CmdData }) {
  const zone = ZONE_STYLE[d.danger.zone];
  const topPlatform = d.heatmap[0]?.platform;
  const topThreat = d.trending[0];
  return (
    <Glass className="p-5 h-full">
      <CardHeader label="Executive Summary" sub="AI-generated status brief" />
      <div className="space-y-3 text-sm">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1">Status</div>
          <div className="font-semibold" style={{ color: zone.color }}>{d.top.threatLevel} · {zone.label}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1">Key Risks</div>
          <ul className="space-y-1 text-xs text-foreground/80">
            <li>· {d.overview.criticalFindings} critical, {d.overview.totalFindings} total findings last 14d</li>
            <li>· {d.overview.newToday} new in the last 24h ({d.danger.velocityDelta >= 0 ? "+" : ""}{d.danger.velocityDelta} vs prior)</li>
            {topPlatform && <li>· Highest concentration: {topPlatform}</li>}
          </ul>
        </div>
        {topThreat && (
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1">Most Dangerous</div>
            <div className="text-xs line-clamp-2">{topThreat.title}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{topThreat.platform} · Threat {Math.round(topThreat.threatScore)}</div>
          </div>
        )}
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1">Recommended</div>
          <ul className="space-y-1 text-xs text-foreground/80">
            {d.overview.criticalFindings > 0 && <li>· Review {d.overview.criticalFindings} critical findings</li>}
            {d.top.pendingActions > 0 && <li>· Advance {d.top.pendingActions} pending enforcement actions</li>}
            {d.top.protectedAssets === 0 && <li>· Register at least one protected asset</li>}
            {d.overview.criticalFindings === 0 && d.top.pendingActions === 0 && <li>· All clear — continue monitoring</li>}
          </ul>
        </div>
      </div>
    </Glass>
  );
}

/* ---------- Live scanners ---------- */
function LiveScannerPanel({ d }: { d: CmdData }) {
  const iconFor: Record<string, React.ComponentType<{ className?: string }>> = {
    Web: Globe, YouTube: Youtube, News: Newspaper, Reddit: MessageCircle, Social: Radio, Archive: FileText,
  };
  return (
    <Glass className="p-5">
      <CardHeader label="Live Scanner Panel" sub="Reconnaissance surface status" action={<Link to="/scan" className="text-[11px] text-primary hover:underline inline-flex items-center gap-1">Run scan <ChevronRight className="size-3" /></Link>} />
      <div className="space-y-2.5">
        {d.liveScanners.map((s) => {
          const Icon = iconFor[s.kind] ?? Globe;
          const isRunning = s.status === "running";
          const tone = s.status === "completed" ? "oklch(0.7 0.16 155)" : isRunning ? "oklch(0.65 0.18 240)" : s.status === "failed" ? "oklch(0.63 0.24 25)" : "oklch(0.68 0.09 240)";
          return (
            <div key={s.kind} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
              <div className="flex items-center gap-3">
                <div className="size-8 rounded-lg grid place-items-center" style={{ background: `color-mix(in oklab, ${tone} 16%, transparent)`, color: tone }}>
                  <Icon className="size-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-semibold">{s.kind} Scanner</div>
                    <span className="text-[9px] tracking-widest uppercase font-bold px-1.5 py-0.5 rounded" style={{ color: tone, background: `color-mix(in oklab, ${tone} 15%, transparent)` }}>{s.status}</span>
                    {isRunning && <Loader2 className="size-3 animate-spin" style={{ color: tone }} />}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">{s.query ?? "No active query"}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold tabular-nums">{s.results}</div>
                  <div className="text-[9px] uppercase tracking-widest text-muted-foreground">hits</div>
                </div>
              </div>
              <div className="h-1 mt-2 rounded-full bg-white/5 overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${s.progress}%`, background: tone }} />
              </div>
            </div>
          );
        })}
      </div>
    </Glass>
  );
}

/* ---------- Threat heatmap ---------- */
function ThreatHeatmap({ d }: { d: CmdData }) {
  const sevs = ["Critical", "High", "Medium", "Low", "Info"];
  const max = Math.max(1, ...d.heatmap.flatMap((r) => sevs.map((s) => (r as any)[s] ?? 0)));
  return (
    <Glass className="p-5">
      <CardHeader label="Threat Heatmap" sub="Platform × severity concentration" />
      {d.heatmap.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">No findings yet — run a scan.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="text-left pb-2 pr-2 font-semibold">Platform</th>
                {sevs.map((s) => (
                  <th key={s} className="pb-2 px-2 font-semibold" style={{ color: SEV_COLOR[s] }}>{s}</th>
                ))}
                <th className="pb-2 pl-2 font-semibold text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {d.heatmap.map((r) => (
                <tr key={r.platform} className="border-t border-white/5">
                  <td className="py-2 pr-2 font-semibold">{r.platform}</td>
                  {sevs.map((s) => {
                    const v = (r as any)[s] ?? 0;
                    const intensity = v / max;
                    return (
                      <td key={s} className="px-1 py-1">
                        <div className="rounded-md text-center py-1.5 font-semibold tabular-nums text-[11px]" style={{ background: `color-mix(in oklab, ${SEV_COLOR[s]} ${Math.round(8 + intensity * 60)}%, transparent)`, color: intensity > 0.3 ? "white" : SEV_COLOR[s] }}>
                          {v || ""}
                        </div>
                      </td>
                    );
                  })}
                  <td className="pl-2 py-2 text-right font-bold tabular-nums">{r.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Glass>
  );
}

/* ---------- Spoiler detector ---------- */
function ReputationSpoilerDetector({ d }: { d: CmdData }) {
  return (
    <Glass className="p-5">
      <CardHeader label="Reputation Spoiler Detector" sub="AI-classified content likely to damage reputation" />
      {d.spoilers.length === 0 ? (
        <div className="text-sm text-muted-foreground py-6 text-center">No reputation spoilers detected in the last 14 days.</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          {d.spoilers.map((s) => {
            const tone = SEV_COLOR[s.risk];
            return (
              <div key={s.category} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="size-3.5" style={{ color: tone }} />
                  <div className="text-xs font-semibold truncate">{s.category}</div>
                </div>
                <div className="mt-2 flex items-end justify-between">
                  <div className="text-xl font-display font-bold tabular-nums" style={{ color: tone }}>{s.count}</div>
                  <div className="text-[10px] uppercase tracking-wider font-bold" style={{ color: tone }}>{s.risk}</div>
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">Reach {fmt(s.reach)}</div>
              </div>
            );
          })}
        </div>
      )}
    </Glass>
  );
}

/* ---------- Trending threats ---------- */
function TrendingThreats({ d }: { d: CmdData }) {
  return (
    <Glass className="p-5">
      <CardHeader label="Trending Threats" sub="Top 10 by threat × reach" action={<Link to="/threat-radar" className="text-[11px] text-primary hover:underline inline-flex items-center gap-1">Open radar <ChevronRight className="size-3" /></Link>} />
      {d.trending.length === 0 ? (
        <div className="text-sm text-muted-foreground py-6 text-center">Nothing trending — you're clear.</div>
      ) : (
        <div className="space-y-2">
          {d.trending.map((t, i) => {
            const sev = t.severity[0].toUpperCase() + t.severity.slice(1).toLowerCase();
            const tone = SEV_COLOR[sev] ?? SEV_COLOR.Low;
            return (
              <div key={t.id} className="flex items-center gap-3 p-2.5 rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] transition">
                <div className="text-xs font-bold tabular-nums w-5 text-muted-foreground">{String(i + 1).padStart(2, "0")}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{t.title}</div>
                  <div className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5">
                    <span>{t.platform}</span>
                    <span>·</span>
                    <span>Reach {fmt(t.reach)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded" style={{ color: tone, background: `color-mix(in oklab, ${tone} 15%, transparent)` }}>{sev}</span>
                  <div className="text-right w-10">
                    <div className="text-sm font-bold tabular-nums" style={{ color: tone }}>{Math.round(t.threatScore)}</div>
                  </div>
                  {t.permalink && (
                    <a href={t.permalink} target="_blank" rel="noreferrer" className="size-7 grid place-items-center rounded-lg border border-white/10 hover:border-primary/40 text-muted-foreground hover:text-primary"><ExternalLink className="size-3" /></a>
                  )}
                  <Link to="/scan" className="size-7 grid place-items-center rounded-lg border border-white/10 hover:border-primary/40 text-muted-foreground hover:text-primary" title="View / evidence / take action"><Eye className="size-3" /></Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Glass>
  );
}

/* ---------- Asset exposure ---------- */
function AssetExposurePanel({ d }: { d: CmdData }) {
  return (
    <Glass className="p-5 h-full">
      <CardHeader label="Asset Exposure" sub="Most targeted protected assets" action={<Link to="/assets" className="text-[11px] text-primary hover:underline inline-flex items-center gap-1">Assets <ChevronRight className="size-3" /></Link>} />
      {d.assetExposure.length === 0 ? (
        <div className="text-sm text-muted-foreground py-6 text-center">No protected assets yet.</div>
      ) : (
        <div className="space-y-2.5">
          {d.assetExposure.map((a) => (
            <div key={a.name} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{a.name}</div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{a.kind}</div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-display font-bold tabular-nums" style={{ color: a.riskScore >= 70 ? SEV_COLOR.Critical : a.riskScore >= 40 ? SEV_COLOR.High : SEV_COLOR.Low }}>{a.riskScore}</div>
                  <div className="text-[9px] uppercase tracking-widest text-muted-foreground">risk</div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-2 text-center">
                <div><div className="text-xs font-bold tabular-nums">{a.mentions}</div><div className="text-[9px] uppercase text-muted-foreground tracking-widest">Mentions</div></div>
                <div><div className="text-xs font-bold tabular-nums" style={{ color: SEV_COLOR.High }}>{a.threats}</div><div className="text-[9px] uppercase text-muted-foreground tracking-widest">Threats</div></div>
                <div><div className="text-xs font-bold tabular-nums">{fmt(a.reach)}</div><div className="text-[9px] uppercase text-muted-foreground tracking-widest">Reach</div></div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Glass>
  );
}

/* ---------- Scan timeline ---------- */
function ScanTimeline({ d }: { d: CmdData }) {
  const iconFor: Record<string, React.ComponentType<{ className?: string }>> = {
    finding: AlertTriangle, evidence: FileText, enforcement: PlayCircle,
  };
  const toneFor: Record<string, string> = {
    finding: "oklch(0.72 0.18 55)", evidence: "oklch(0.55 0.22 295)", enforcement: "oklch(0.7 0.16 155)",
  };
  return (
    <Glass className="p-5">
      <CardHeader label="Scan Timeline" sub="Threat discovery, evidence & enforcement events" />
      {d.timeline.length === 0 ? (
        <div className="text-sm text-muted-foreground py-6 text-center">No events yet.</div>
      ) : (
        <div className="relative pl-6">
          <div className="absolute left-2 top-1 bottom-1 w-px bg-white/10" />
          <div className="space-y-3">
            {d.timeline.map((ev, i) => {
              const Icon = iconFor[ev.type] ?? Activity;
              const tone = toneFor[ev.type] ?? "oklch(0.65 0.18 240)";
              return (
                <div key={i} className="relative flex items-start gap-3">
                  <div className="absolute -left-6 top-1 size-4 rounded-full grid place-items-center" style={{ background: `color-mix(in oklab, ${tone} 25%, transparent)`, color: tone }}>
                    <Icon className="size-2.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{ev.label}</div>
                    <div className="text-[10px] text-muted-foreground">{ev.sub ? `${ev.sub} · ` : ""}{timeAgo(ev.time)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Glass>
  );
}

/* ---------- Action center ---------- */
function ActionCenter() {
  const actions: { label: string; to: string; icon: React.ComponentType<{ className?: string }>; tone: string }[] = [
    { label: "Run Full Scan", to: "/scan", icon: Radar, tone: "oklch(0.65 0.18 240)" },
    { label: "Generate Report", to: "/reports", icon: FileText, tone: "oklch(0.55 0.22 295)" },
    { label: "Evidence Center", to: "/intelligence", icon: Sparkles, tone: "oklch(0.68 0.09 240)" },
    { label: "Review Threats", to: "/threat-radar", icon: ShieldAlert, tone: "oklch(0.72 0.18 55)" },
    { label: "Create Case", to: "/cases", icon: Flame, tone: "oklch(0.63 0.24 25)" },
    { label: "Launch Enforcement", to: "/enforcement", icon: PlayCircle, tone: "oklch(0.7 0.16 155)" },
  ];
  return (
    <Glass className="p-5 h-full">
      <CardHeader label="Action Center" sub="Quick launch" />
      <div className="grid grid-cols-2 gap-2.5">
        {actions.map((a) => {
          const Icon = a.icon;
          return (
            <Link key={a.label} to={a.to} className="rounded-xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.06] transition p-3 group">
              <div className="size-9 rounded-lg grid place-items-center" style={{ background: `color-mix(in oklab, ${a.tone} 18%, transparent)`, color: a.tone }}>
                <Icon className="size-4" />
              </div>
              <div className="text-xs font-semibold mt-2">{a.label}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5 group-hover:text-primary inline-flex items-center gap-1">Open <ChevronRight className="size-2.5" /></div>
            </Link>
          );
        })}
      </div>
    </Glass>
  );
}
