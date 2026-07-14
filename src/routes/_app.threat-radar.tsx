import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { PageCard, Pill, StatCard } from "@/components/dashboard/PageCard";
import { severityColor, type Severity, type Status, type RiskType, type Virality } from "@/lib/data-store";
import {
  Youtube, Instagram, Music2, Newspaper, Facebook, MessageCircle, Megaphone,
  Globe, TrendingUp, Flame, Activity, Eye, FileSearch, FolderPlus, FileText, Send, X, MapPin, Loader2,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/threat-radar")({
  head: () => ({ meta: [{ title: "Threat Radar — Eterna AI" }] }),
  component: ThreatRadarPage,
});

const RISK_TYPES: (RiskType | "All")[] = ["All", "Defamation", "Impersonation", "Deepfake", "Copyright", "Fraud", "Scam", "Brand Abuse", "News Attack"];
const VIRALITIES: (Virality | "All")[] = ["All", "Normal", "Growing", "Viral", "Exploding"];

interface HitRow {
  id: string;
  title: string | null;
  description: string | null;
  source: string;
  source_type: string | null;
  country: string | null;
  permalink: string | null;
  canonical_url: string | null;
  reach: number | null;
  threat_score: number | null;
  risk_score: number | null;
  severity: string | null;
  velocity: string | null;
  risk_type: string | null;
  growth_pct: number | null;
  narrative_claim: string | null;
  first_seen_at: string;
  last_seen_at: string;
  times_detected: number;
  tags: string[];
  metrics: Record<string, unknown> | null;
  source_metadata: Record<string, unknown> | null;
  evidence_refs: unknown[] | null;
}

interface Threat {
  id: string;
  title: string;
  sourceType: string;
  riskType: RiskType;
  platform: string;
  severity: Severity;
  location: string;
  status: Status;
  confidence: number;
  threatScore: number;
  reach: number;
  sources: number;
  evidence: number;
  velocity: Virality;
  firstDetected: string;
  latestActivity: string;
  growthPct: number;
  narrativeClaim: string;
  caseId?: string;
}

function platformIcon(p: string) {
  const k = p.toLowerCase();
  if (k.includes("youtube")) return Youtube;
  if (k.includes("instagram")) return Instagram;
  if (k.includes("tiktok")) return Music2;
  if (k.includes("news") || k.includes("portal")) return Newspaper;
  if (k.includes("facebook") || k.includes("meta")) return Facebook;
  if (k.includes("reddit")) return MessageCircle;
  if (k.includes("ad")) return Megaphone;
  return Globe;
}

function viralityStyle(v: Virality) {
  switch (v) {
    case "Exploding": return { color: "oklch(0.63 0.24 25)", icon: Flame, label: "Exploding" };
    case "Viral": return { color: "oklch(0.7 0.2 35)", icon: TrendingUp, label: "Viral" };
    case "Growing": return { color: "oklch(0.75 0.16 70)", icon: Activity, label: "Growing" };
    default: return { color: "oklch(0.68 0.16 155)", icon: Activity, label: "Normal" };
  }
}

function formatReach(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

function shortDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

const SEV_SET: Severity[] = ["Critical", "High", "Medium", "Low"];
const VIR_SET: Virality[] = ["Normal", "Growing", "Viral", "Exploding"];
const RISK_SET: RiskType[] = ["Defamation", "Impersonation", "Deepfake", "Copyright", "Fraud", "Scam", "Brand Abuse", "News Attack"];
const STATUS_SET: Status[] = ["Detected", "In Review", "Takedown Sent", "Resolved"];

function normSeverity(s: string | null, threatScore: number): Severity {
  const t = (s ?? "").toLowerCase();
  if (t === "critical") return "Critical";
  if (t === "high") return "High";
  if (t === "medium") return "Medium";
  if (t === "low") return "Low";
  if (threatScore >= 85) return "Critical";
  if (threatScore >= 70) return "High";
  if (threatScore >= 40) return "Medium";
  return "Low";
}

function normVirality(v: string | null, growth: number): Virality {
  const t = (v ?? "").toLowerCase();
  if (VIR_SET.map((x) => x.toLowerCase()).includes(t)) {
    return (t.charAt(0).toUpperCase() + t.slice(1)) as Virality;
  }
  if (growth >= 100) return "Exploding";
  if (growth >= 40) return "Viral";
  if (growth >= 10) return "Growing";
  return "Normal";
}

function normRiskType(r: string | null): RiskType {
  const match = RISK_SET.find((x) => x.toLowerCase() === (r ?? "").toLowerCase());
  return match ?? "News Attack";
}

function normStatus(row: HitRow): Status {
  const s = (row.metrics as Record<string, unknown> | null)?.["radar_status"] as string | undefined;
  const match = STATUS_SET.find((x) => x === s);
  return match ?? "Detected";
}

function platformOf(row: HitRow): string {
  const src = (row.source ?? "").toLowerCase();
  const meta = (row.source_metadata ?? {}) as Record<string, unknown>;
  const explicit = (meta.platform as string | undefined) ?? row.source_type ?? row.source;
  if (src.includes("youtube")) return "YouTube";
  if (src.includes("instagram")) return "Instagram";
  if (src.includes("tiktok")) return "TikTok";
  if (src.includes("facebook") || src.includes("meta")) return "Facebook";
  if (src.includes("reddit")) return "Reddit";
  if (src.includes("news")) return "News Portal";
  return explicit || "Web";
}

function toThreat(row: HitRow): Threat {
  const threatScore = Math.round(Number(row.threat_score ?? row.risk_score ?? 0));
  const reach = Number(row.reach ?? 0);
  const growth = Number(row.growth_pct ?? 0);
  const evidenceCount = Array.isArray(row.evidence_refs) ? row.evidence_refs.length : 0;
  const metricSources = Number((row.metrics as Record<string, unknown> | null)?.["sources"] ?? 0);
  const meta = (row.source_metadata ?? {}) as Record<string, unknown>;

  return {
    id: row.id,
    title: row.title || row.narrative_claim || row.canonical_url || row.permalink || "Untitled finding",
    sourceType: row.source_type || row.source,
    riskType: normRiskType(row.risk_type),
    platform: platformOf(row),
    severity: normSeverity(row.severity, threatScore),
    location: row.country || (meta.country as string | undefined) || "Global",
    status: normStatus(row),
    confidence: Math.round(Number(row.risk_score ?? row.threat_score ?? 0)),
    threatScore,
    reach,
    sources: Math.max(1, metricSources || row.times_detected || 1),
    evidence: Math.max(evidenceCount, 1),
    velocity: normVirality(row.velocity, growth),
    firstDetected: shortDate(row.first_seen_at),
    latestActivity: shortDate(row.last_seen_at),
    growthPct: Math.round(growth),
    narrativeClaim: row.narrative_claim || row.description || "No narrative claim extracted yet.",
    caseId: (row.metrics as Record<string, unknown> | null)?.["case_id"] as string | undefined,
  };
}

function ThreatRadarPage() {
  const { session, ready } = useSession();
  const userId = session?.user.id;
  const qc = useQueryClient();

  const [risk, setRisk] = useState<(typeof RISK_TYPES)[number]>("All");
  const [sev, setSev] = useState<Severity | "All">("All");
  const [vir, setVir] = useState<(typeof VIRALITIES)[number]>("All");
  const [selected, setSelected] = useState<Threat | null>(null);

  const hitsQuery = useQuery({
    queryKey: ["threat_radar_hits", userId],
    enabled: ready && !!userId,
    queryFn: async (): Promise<HitRow[]> => {
      const { data, error } = await supabase
        .from("scan_hits")
        .select("id,title,description,source,source_type,country,permalink,canonical_url,reach,threat_score,risk_score,severity,velocity,risk_type,growth_pct,narrative_claim,first_seen_at,last_seen_at,times_detected,tags,metrics,source_metadata,evidence_refs")
        .order("threat_score", { ascending: false, nullsFirst: false })
        .order("last_seen_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as HitRow[];
    },
  });

  const statusMut = useMutation({
    mutationFn: async ({ id, status, current }: { id: string; status: Status; current: Record<string, unknown> | null }) => {
      const nextMetrics = { ...(current ?? {}), radar_status: status };
      const { error } = await supabase.from("scan_hits").update({ metrics: nextMetrics }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Status updated");
      qc.invalidateQueries({ queryKey: ["threat_radar_hits", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = hitsQuery.data ?? [];
  const threats = useMemo(() => rows.map(toThreat), [rows]);
  const rowById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  const list = threats.filter(
    (t) =>
      (risk === "All" || t.riskType === risk) &&
      (sev === "All" || t.severity === sev) &&
      (vir === "All" || t.velocity === vir),
  );

  const totals = useMemo(() => {
    const reach = threats.reduce((a, t) => a + t.reach, 0);
    const narratives = new Set(threats.map((t) => t.narrativeClaim)).size;
    return {
      active: threats.length,
      critical: threats.filter((t) => t.severity === "Critical").length,
      reach,
      narratives,
    };
  }, [threats]);

  const geoBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of threats) map.set(t.location, (map.get(t.location) ?? 0) + t.evidence);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [threats]);
  const geoMax = Math.max(1, ...geoBreakdown.map(([, n]) => n));

  const handleStatus = (t: Threat, s: Status) => {
    const row = rowById.get(t.id);
    statusMut.mutate({ id: t.id, status: s, current: row?.metrics ?? null });
  };

  const loading = !ready || hitsQuery.isLoading;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="ACTIVE THREATS" value={totals.active} accent="oklch(0.63 0.24 25)" sub="Across all platforms" />
        <StatCard label="CRITICAL THREATS" value={totals.critical} accent="oklch(0.63 0.24 25)" sub="Require immediate action" />
        <StatCard label="TOTAL REACH" value={formatReach(totals.reach)} accent="oklch(0.55 0.22 295)" sub="Combined audience exposure" />
        <StatCard label="NARRATIVES TRACKED" value={totals.narratives} accent="oklch(0.68 0.16 155)" sub="Distinct claim clusters" />
      </div>

      <PageCard
        title="LIVE RADAR"
        sub="Filter by risk type, severity and virality"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {RISK_TYPES.map((c) => (
              <button
                key={c}
                onClick={() => setRisk(c)}
                className={`text-xs px-3 py-1.5 rounded-full border ${risk === c ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-accent"}`}
              >
                {c}
              </button>
            ))}
            <select value={sev} onChange={(e) => setSev(e.target.value as Severity | "All")} className="text-xs px-3 py-1.5 rounded-full border border-border bg-card">
              {(["All", ...SEV_SET] as const).map((s) => (<option key={s}>{s}</option>))}
            </select>
            <select value={vir} onChange={(e) => setVir(e.target.value as Virality | "All")} className="text-xs px-3 py-1.5 rounded-full border border-border bg-card">
              {VIRALITIES.map((s) => (<option key={s}>{s}</option>))}
            </select>
          </div>
        }
      >
        {loading ? (
          <div className="py-12 flex items-center justify-center text-muted-foreground text-sm gap-2">
            <Loader2 className="size-4 animate-spin" /> Loading live radar…
          </div>
        ) : hitsQuery.error ? (
          <div className="py-12 text-center text-sm text-destructive">Failed to load threats: {(hitsQuery.error as Error).message}</div>
        ) : threats.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground space-y-2">
            <div>No threats detected yet.</div>
            <div>
              Run a scan from the <Link to="/scan" className="text-primary font-semibold">Web Scan</Link> page — findings will appear here in real time.
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {list.map((t) => (
              <ThreatCard key={t.id} t={t} onOpen={() => setSelected(t)} onStatus={(s) => handleStatus(t, s)} />
            ))}
            {list.length === 0 && (
              <div className="col-span-full text-center text-sm text-muted-foreground py-8">No threats match these filters.</div>
            )}
          </div>
        )}
      </PageCard>

      {geoBreakdown.length > 0 && (
        <PageCard title="THREAT RADAR MAP" sub="Findings by region">
          <div className="space-y-2">
            {geoBreakdown.map(([loc, count]) => (
              <div key={loc} className="flex items-center gap-3">
                <div className="w-24 text-sm font-semibold flex items-center gap-1.5">
                  <MapPin className="size-3.5 text-muted-foreground" /> {loc}
                </div>
                <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${(count / geoMax) * 100}%`, background: "var(--gradient-brand)" }} />
                </div>
                <div className="w-24 text-right text-xs text-muted-foreground">{count} findings</div>
              </div>
            ))}
          </div>
        </PageCard>
      )}

      {selected && <DetailPanel t={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function ThreatCard({ t, onOpen, onStatus }: { t: Threat; onOpen: () => void; onStatus: (s: Status) => void }) {
  const PIcon = platformIcon(t.platform);
  const v = viralityStyle(t.velocity);
  const VIcon = v.icon;

  return (
    <div className="border border-border rounded-xl p-4 hover:border-primary/40 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="size-9 rounded-lg grid place-items-center shrink-0"
            style={{
              background: `color-mix(in oklab, ${severityColor(t.severity)} 14%, white)`,
              color: severityColor(t.severity),
            }}
          >
            <PIcon className="size-4" />
          </div>
          <div className="min-w-0">
            <button onClick={onOpen} className="text-sm font-semibold leading-tight text-left hover:underline truncate block">
              {t.title}
            </button>
            <div className="text-[11px] text-muted-foreground truncate flex items-center gap-1.5">
              <span>{t.platform}</span>
              <span>·</span>
              <span>{t.sourceType}</span>
              <span>·</span>
              <span>{t.location}</span>
            </div>
          </div>
        </div>
        <Pill color={severityColor(t.severity)}>{t.severity}</Pill>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2">
        <Metric label="Score" value={`${t.threatScore}`} strong />
        <Metric label="Reach" value={formatReach(t.reach)} />
        <Metric label="Sources" value={`${t.sources}`} />
        <Metric label="Evidence" value={`${t.evidence}`} />
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 text-[11px]">
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full font-semibold" style={{ background: `color-mix(in oklab, ${v.color} 14%, white)`, color: v.color }}>
          <VIcon className="size-3" /> {v.label}
        </span>
        <span className="text-muted-foreground">{t.riskType}</span>
        <span className="text-muted-foreground">
          {t.firstDetected} → {t.latestActivity}
          <span className="ml-1 font-semibold" style={{ color: t.growthPct > 50 ? "oklch(0.63 0.24 25)" : "oklch(0.55 0.15 260)" }}>
            +{t.growthPct}%
          </span>
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">
          {t.caseId ? (<>Case <Link to="/cases" className="text-primary font-semibold">#{t.caseId}</Link></>) : (<span className="italic">Not assigned</span>)}
        </span>
        <select
          value={t.status}
          onChange={(e) => onStatus(e.target.value as Status)}
          className="text-[11px] px-2 py-1 rounded-md border border-border bg-card"
        >
          {STATUS_SET.map((s) => (<option key={s}>{s}</option>))}
        </select>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <ActionBtn icon={Eye} onClick={onOpen}>View Evidence</ActionBtn>
        <ActionBtn icon={FileSearch} to="/intelligence">Investigate</ActionBtn>
        <ActionBtn icon={FolderPlus} to="/cases">Send to Case</ActionBtn>
        <ActionBtn icon={FileText} to="/reports">Report</ActionBtn>
        <ActionBtn icon={Send} to="/enforcement" primary>Takedown</ActionBtn>
      </div>
    </div>
  );
}

function Metric({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-lg border border-border/70 px-2 py-1.5 text-center">
      <div className={`${strong ? "text-base font-bold" : "text-sm font-semibold"}`}>{value}</div>
      <div className="text-[10px] tracking-wider text-muted-foreground uppercase">{label}</div>
    </div>
  );
}

function ActionBtn({
  icon: Icon, children, onClick, to, primary,
}: { icon: typeof Eye; children: React.ReactNode; onClick?: () => void; to?: string; primary?: boolean }) {
  const cls = `inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md ${primary ? "text-white" : "border border-border hover:bg-accent"}`;
  const style = primary ? { background: "var(--gradient-brand)" } : undefined;
  if (to) return <Link to={to} className={cls} style={style}><Icon className="size-3" />{children}</Link>;
  return <button onClick={onClick} className={cls} style={style}><Icon className="size-3" />{children}</button>;
}

function DetailPanel({ t, onClose }: { t: Threat; onClose: () => void }) {
  const v = viralityStyle(t.velocity);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-md bg-card h-full overflow-y-auto border-l border-border p-5 space-y-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground">THREAT DETAIL</div>
            <div className="text-lg font-bold leading-tight">{t.title}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{t.platform} · {t.sourceType} · {t.location}</div>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-accent"><X className="size-4" /></button>
        </div>

        <div>
          <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground mb-2">THREAT OVERVIEW</div>
          <div className="grid grid-cols-2 gap-2">
            <Metric label="Threat Score" value={`${t.threatScore}`} strong />
            <Metric label="Reach" value={formatReach(t.reach)} strong />
            <Metric label="Velocity" value={v.label} />
            <Metric label="Confidence" value={`${t.confidence}%`} />
          </div>
        </div>

        <div>
          <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground mb-2">NARRATIVE SUMMARY</div>
          <div className="rounded-lg border border-border p-3 space-y-1.5 text-sm">
            <div><span className="text-muted-foreground text-xs">Claim: </span>&ldquo;{t.narrativeClaim}&rdquo;</div>
            <div className="text-xs text-muted-foreground">Detected across {t.sources} sources · First seen {t.firstDetected} · Trend +{t.growthPct}%</div>
          </div>
        </div>

        <div>
          <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground mb-2">TIMELINE</div>
          <div className="text-xs space-y-1">
            <div>First Detected: <span className="font-semibold">{t.firstDetected}</span></div>
            <div>Latest Activity: <span className="font-semibold">{t.latestActivity}</span></div>
            <div>Growth: <span className="font-semibold" style={{ color: "oklch(0.63 0.24 25)" }}>+{t.growthPct}%</span></div>
          </div>
        </div>

        <div>
          <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground mb-2">CASE</div>
          <div className="text-sm">
            {t.caseId ? (<Link to="/cases" className="text-primary font-semibold">#{t.caseId}</Link>) : (
              <Link to="/cases" className="text-primary font-semibold">+ Assign to case</Link>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
          <ActionBtn icon={FileSearch} to="/intelligence">Investigate</ActionBtn>
          <ActionBtn icon={FolderPlus} to="/cases">Send to Case</ActionBtn>
          <ActionBtn icon={FileText} to="/reports">Generate Report</ActionBtn>
          <ActionBtn icon={Send} to="/enforcement" primary>Start Takedown</ActionBtn>
        </div>
      </div>
    </div>
  );
}
