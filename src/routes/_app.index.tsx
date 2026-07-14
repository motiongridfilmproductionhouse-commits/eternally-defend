import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer,
  Tooltip, XAxis, YAxis, Cell,
} from "recharts";
import {
  Shield, AlertTriangle, Send, Clock, TrendingUp, TrendingDown,
  ArrowUpRight, Zap, Activity, ScanLine, Youtube, Instagram, Music2,
  MessageCircle, Newspaper, Twitter,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { getDashboardStats } from "@/lib/mm/dashboard.functions";

export const Route = createFileRoute("/_app/")({
  component: DashboardPage,
});

/* ---------- palette ---------- */
const C = {
  bgCard: "#222536",
  bgCardAlt: "#262A3D",
  white: "#F8FAFC",
  darkText: "#0F172A",
  muted: "#A8AFC3",
  blue: "#1E88FF",
  blueDeep: "#1769E0",
  critical: "#FF4D67",
  warning: "#FFB020",
  success: "#21C77A",
};
const BLUE_GRAD = "linear-gradient(135deg,#1769E0 0%,#1E8CFF 100%)";

/* ============= ROUTE ============= */
function DashboardPage() {
  const { session } = useSession();
  const enabled = !!session;

  const dashFn = useServerFn(getDashboardStats);
  const dash = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => dashFn({}),
    enabled,
    refetchInterval: 30_000,
  });

  const counts = useQuery({
    queryKey: ["dash-counts", session?.user.id],
    enabled,
    queryFn: async () => {
      const [assets, cases, takedowns] = await Promise.all([
        supabase.from("protected_assets").select("id", { count: "exact", head: true }),
        supabase.from("cases").select("id", { count: "exact", head: true })
          .in("status", ["Open", "In Progress", "Escalated"])
          .in("priority", ["Critical", "High"]),
        supabase.from("enforcement_requests").select("id", { count: "exact", head: true }).neq("status", "Queued"),
      ]);
      return {
        assets: assets.count ?? 0,
        criticalCases: cases.count ?? 0,
        takedowns: takedowns.count ?? 0,
      };
    },
    refetchInterval: 30_000,
  });

  const findings = dash.data?.totals.findings ?? 0;
  const exposureScore = dash.data?.exposure.score ?? 0;
  const reputation = findings > 0 ? Math.max(0, Math.min(100, Math.round(100 - exposureScore * 10))) : null;

  /* Chart data derived from timeline events (no mock stats) */
  const trendData = useMemo(() => buildTrend(dash.data?.timeline ?? []), [dash.data?.timeline]);
  const platformData = useMemo(() => buildPlatform(dash.data?.hotspots ?? []), [dash.data?.hotspots]);

  return (
    <div className="min-w-0 pb-6">
      <div className="grid grid-cols-12 gap-5 auto-rows-min">
        {/* ROW 1 */}
        <ReputationOverview
          className="col-span-12 lg:col-span-7"
          reputation={reputation}
          trend={trendData}
          findings={findings}
          severity={dash.data?.exposure.severityLabel ?? "No Data"}
        />
        <ReputationScoreCard
          className="col-span-6 lg:col-span-2"
          score={reputation}
        />
        <ThreatVelocityCard
          className="col-span-6 lg:col-span-3"
          findings={findings}
          velocity={Math.min(100, Math.round(exposureScore * 10))}
        />

        {/* ROW 2 */}
        <ThreatTrendCard
          className="col-span-12 lg:col-span-8"
          data={trendData}
          hasData={findings > 0}
        />
        <CriticalCasesCard
          className="col-span-6 lg:col-span-2"
          count={counts.data?.criticalCases ?? 0}
        />
        <ProtectedAssetsCard
          className="col-span-6 lg:col-span-2"
          count={counts.data?.assets ?? 0}
        />

        {/* ROW 3 */}
        <ActiveThreatsCard
          className="col-span-12 md:col-span-6 lg:col-span-4"
          count={findings}
          trend={trendData}
        />
        <TakedownsCard
          className="col-span-12 md:col-span-6 lg:col-span-4"
          count={counts.data?.takedowns ?? 0}
        />
        <PlatformCard
          className="col-span-12 lg:col-span-4"
          data={platformData}
        />
      </div>
    </div>
  );
}

/* ============= CARDS ============= */

function Card({
  className = "", tone = "dark", children,
}: { className?: string; tone?: "dark" | "white" | "blue"; children: React.ReactNode }) {
  const base = "relative rounded-[22px] p-6 md:p-7 overflow-hidden border";
  const styles: React.CSSProperties =
    tone === "white"
      ? { background: C.white, color: C.darkText, borderColor: "rgba(15,23,42,0.06)", boxShadow: "0 12px 32px -18px rgba(15,23,42,0.35)" }
      : tone === "blue"
      ? { background: BLUE_GRAD, color: C.white, borderColor: "rgba(255,255,255,0.14)", boxShadow: "0 18px 44px -18px rgba(23,105,224,0.7)" }
      : { background: C.bgCard, color: C.white, borderColor: "rgba(255,255,255,0.06)", boxShadow: "0 12px 32px -18px rgba(0,0,0,0.6)" };
  return <div className={`${base} ${className}`} style={styles}>{children}</div>;
}

function Label({ children, tone = "dark" }: { children: React.ReactNode; tone?: "dark" | "white" | "blue" }) {
  const color = tone === "white" ? "#64748B" : tone === "blue" ? "rgba(255,255,255,0.85)" : C.muted;
  return <div className="text-[11px] font-semibold tracking-[0.18em] uppercase" style={{ color }}>{children}</div>;
}

function IconBadge({ Icon, tone = "dark", color }: { Icon: any; tone?: "dark" | "white" | "blue"; color?: string }) {
  const bg =
    tone === "white" ? "rgba(20,122,243,0.10)" :
    tone === "blue" ? "rgba(255,255,255,0.18)" :
    "rgba(30,136,255,0.14)";
  const fg = color ?? (tone === "blue" ? "#FFFFFF" : C.blue);
  return (
    <div className="size-10 rounded-xl grid place-items-center shrink-0" style={{ background: bg, color: fg }}>
      <Icon className="size-5" />
    </div>
  );
}

/* ---- Reputation Overview (dark hero) ---- */
function ReputationOverview({ className, reputation, trend, findings, severity }: {
  className?: string; reputation: number | null; trend: TrendPoint[]; findings: number; severity: string;
}) {
  const hasData = findings > 0;
  const risk =
    reputation === null ? { label: "—", color: C.muted } :
    reputation >= 80 ? { label: "Excellent", color: C.success } :
    reputation >= 60 ? { label: "Healthy", color: C.success } :
    reputation >= 40 ? { label: "At Risk", color: C.warning } :
    { label: "Critical", color: C.critical };

  return (
    <Card className={className}>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <Label>Reputation Overview</Label>
          <h2 className="mt-2 font-display text-2xl font-bold tracking-tight text-white">Protection health</h2>
          <p className="text-sm mt-1" style={{ color: C.muted }}>
            {hasData ? `Aggregated across ${findings} finding${findings === 1 ? "" : "s"}` : "Awaiting first scan"}
          </p>
        </div>
        <PeriodPill />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-8 items-center">
        <div className="flex items-center gap-5">
          <MiniRing value={reputation} />
          <div>
            <Label>Risk Level</Label>
            <div className="text-2xl font-bold mt-1" style={{ color: risk.color }}>{risk.label}</div>
            <div className="text-xs mt-1" style={{ color: C.muted }}>Severity: {severity}</div>
          </div>
        </div>

        {hasData ? (
          <div className="h-[160px]">
            <ResponsiveContainer>
              <AreaChart data={trend} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="repArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.blue} stopOpacity={0.55} />
                    <stop offset="100%" stopColor={C.blue} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip contentStyle={{ background: C.bgCardAlt, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, color: C.white, fontSize: 12 }} />
                <Area type="monotone" dataKey="count" stroke={C.blue} strokeWidth={2.5} fill="url(#repArea)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyInline
            icon={ScanLine}
            title="No monitoring data yet"
            sub="Run your first scan to establish a reputation baseline."
            cta={<Link to="/scan" className="inline-flex items-center gap-2 px-4 h-10 rounded-xl font-semibold text-sm text-white shadow-lg" style={{ background: BLUE_GRAD, boxShadow: "0 10px 28px -10px rgba(23,105,224,0.8)" }}>Run First Scan <ArrowUpRight className="size-4" /></Link>}
          />
        )}
      </div>
    </Card>
  );
}

/* ---- White Reputation Score ---- */
function ReputationScoreCard({ className, score }: { className?: string; score: number | null }) {
  return (
    <Card className={className} tone="white">
      <Label tone="white">Reputation Score</Label>
      <div className="mt-3 flex items-end gap-2">
        <div className="font-display font-bold text-[56px] leading-none tracking-tight" style={{ color: C.darkText }}>
          {score === null ? "—" : score}
        </div>
        <div className="text-sm pb-2" style={{ color: "#64748B" }}>/100</div>
      </div>
      <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(15,23,42,0.06)" }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${score ?? 0}%`, background: BLUE_GRAD }} />
      </div>
      <div className="mt-3 text-xs" style={{ color: "#64748B" }}>
        {score === null ? "Run a scan to score" : score >= 70 ? "Above threshold" : "Below threshold"}
      </div>
    </Card>
  );
}

/* ---- Bright Blue Threat Velocity ---- */
function ThreatVelocityCard({ className, findings, velocity }: { className?: string; findings: number; velocity: number }) {
  const status = findings === 0 ? "Stable" : velocity >= 70 ? "Viral" : velocity >= 40 ? "Rising" : "Stable";
  return (
    <Card className={className} tone="blue">
      <div className="absolute -right-14 -top-14 size-56 rounded-full bg-white/10 blur-2xl" />
      <div className="absolute -left-10 -bottom-14 size-48 rounded-full bg-white/10 blur-2xl" />
      <div className="relative flex items-start justify-between">
        <div>
          <Label tone="blue">Threat Velocity</Label>
          <div className="mt-3 font-display text-5xl font-bold leading-none">{velocity}</div>
          <div className="text-xs mt-2 text-white/80">/100 momentum score</div>
        </div>
        <IconBadge Icon={Zap} tone="blue" />
      </div>
      <RadialGauge value={velocity} />
      <div className="relative mt-4 flex items-center justify-between text-xs">
        <div className="text-white/80">{findings} new</div>
        <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/15 font-semibold">
          {status === "Viral" ? <TrendingUp className="size-3" /> : status === "Rising" ? <TrendingUp className="size-3" /> : <Activity className="size-3" />}
          {status}
        </div>
      </div>
    </Card>
  );
}

/* ---- Threat Trend (dark bar chart) ---- */
function ThreatTrendCard({ className, data, hasData }: { className?: string; data: TrendPoint[]; hasData: boolean }) {
  return (
    <Card className={className}>
      <div className="flex items-start justify-between mb-5">
        <div>
          <Label>Threat Trend</Label>
          <h3 className="mt-2 font-display text-xl font-bold text-white">Detections over time</h3>
        </div>
        <PeriodPill />
      </div>
      {hasData ? (
        <div className="h-[220px]">
          <ResponsiveContainer>
            <BarChart data={data} margin={{ top: 10, right: 0, left: -12, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} width={30} />
              <Tooltip cursor={{ fill: "rgba(30,136,255,0.08)" }} contentStyle={{ background: C.bgCardAlt, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, color: C.white, fontSize: 12 }} />
              <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                {data.map((d, i) => (
                  <Cell key={i} fill={d.count > (Math.max(...data.map(x => x.count)) * 0.7) ? C.blue : "rgba(30,136,255,0.4)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <EmptyInline
          icon={Activity}
          title="No threats detected yet"
          sub="Run a scan or connect a protected asset to begin monitoring."
        />
      )}
    </Card>
  );
}

/* ---- Critical Cases (white) ---- */
function CriticalCasesCard({ className, count }: { className?: string; count: number }) {
  return (
    <Card className={className} tone="white">
      <div className="flex items-start justify-between">
        <Label tone="white">Critical Cases</Label>
        <div className="size-9 rounded-xl grid place-items-center" style={{ background: "rgba(255,77,103,0.10)", color: C.critical }}>
          <Clock className="size-4" />
        </div>
      </div>
      <div className="mt-4 font-display font-bold text-5xl leading-none tracking-tight" style={{ color: C.darkText }}>{count}</div>
      <div className="mt-2 text-xs" style={{ color: "#64748B" }}>High-priority open</div>
      <div className="mt-4 flex items-center gap-1.5 text-xs font-semibold" style={{ color: count > 0 ? C.critical : C.success }}>
        <span className="size-2 rounded-full" style={{ background: count > 0 ? C.critical : C.success }} />
        {count > 0 ? "Requires attention" : "All clear"}
      </div>
    </Card>
  );
}

/* ---- Protected Assets (dark compact) ---- */
function ProtectedAssetsCard({ className, count }: { className?: string; count: number }) {
  return (
    <Card className={className}>
      <div className="flex items-start justify-between">
        <Label>Protected</Label>
        <IconBadge Icon={Shield} />
      </div>
      <div className="mt-4 font-display font-bold text-5xl leading-none tracking-tight text-white">{count}</div>
      <div className="mt-2 text-xs" style={{ color: C.muted }}>Assets registered</div>
      <Link to="/assets" className="mt-4 inline-flex items-center gap-1 text-xs font-semibold" style={{ color: C.blue }}>
        Manage <ArrowUpRight className="size-3" />
      </Link>
    </Card>
  );
}

/* ---- Active Threats (dark w/ sparkline) ---- */
function ActiveThreatsCard({ className, count, trend }: { className?: string; count: number; trend: TrendPoint[] }) {
  return (
    <Card className={className}>
      <div className="flex items-start justify-between">
        <div>
          <Label>Active Threats</Label>
          <div className="mt-3 flex items-baseline gap-3">
            <div className="font-display font-bold text-5xl leading-none tracking-tight text-white">{count}</div>
            {count > 0 && (
              <div className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: C.critical }}>
                <TrendingUp className="size-3" /> Live
              </div>
            )}
          </div>
          <div className="mt-2 text-xs" style={{ color: C.muted }}>Findings across platforms</div>
        </div>
        <IconBadge Icon={AlertTriangle} color={C.critical} />
      </div>
      <div className="mt-5 h-[70px]">
        {count > 0 ? (
          <ResponsiveContainer>
            <AreaChart data={trend}>
              <defs>
                <linearGradient id="threatSpark" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.critical} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={C.critical} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="count" stroke={C.critical} strokeWidth={2} fill="url(#threatSpark)" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full rounded-xl border border-dashed grid place-items-center text-[11px]" style={{ borderColor: "rgba(255,255,255,0.08)", color: C.muted }}>
            No activity — sparkline appears with data
          </div>
        )}
      </div>
    </Card>
  );
}

/* ---- Takedowns Sent (white) ---- */
function TakedownsCard({ className, count }: { className?: string; count: number }) {
  return (
    <Card className={className} tone="white">
      <div className="flex items-start justify-between">
        <div>
          <Label tone="white">Takedowns Sent</Label>
          <div className="mt-3 font-display font-bold text-5xl leading-none tracking-tight" style={{ color: C.darkText }}>{count}</div>
          <div className="mt-2 text-xs" style={{ color: "#64748B" }}>Submitted requests</div>
        </div>
        <div className="size-10 rounded-xl grid place-items-center" style={{ background: "rgba(20,122,243,0.10)", color: C.blue }}>
          <Send className="size-5" />
        </div>
      </div>
      <div className="mt-5 flex items-center gap-3">
        <Link to="/removals" className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-semibold text-white" style={{ background: BLUE_GRAD }}>
          View queue <ArrowUpRight className="size-3.5" />
        </Link>
        <div className="text-xs" style={{ color: "#64748B" }}>
          {count === 0 ? "No submissions yet" : count === 1 ? "1 submission" : `${count} submissions`}
        </div>
      </div>
    </Card>
  );
}

/* ---- Platforms (dark, dot chart) ---- */
const PLATFORM_ICONS: Record<string, any> = {
  YouTube: Youtube, Instagram: Instagram, TikTok: Music2,
  Reddit: MessageCircle, "News Sites": Newspaper, X: Twitter,
};
function PlatformCard({ className, data }: { className?: string; data: PlatformPoint[] }) {
  const hasData = data.length > 0;
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <Card className={className}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <Label>Platform Distribution</Label>
          <h3 className="mt-2 font-display text-lg font-bold text-white">By source</h3>
        </div>
      </div>
      {hasData ? (
        <div className="space-y-3">
          {data.slice(0, 6).map((p) => {
            const Icon = PLATFORM_ICONS[p.name] ?? Activity;
            const pct = Math.round((p.count / max) * 100);
            return (
              <div key={p.name} className="flex items-center gap-3">
                <div className="size-8 rounded-lg grid place-items-center shrink-0" style={{ background: "rgba(30,136,255,0.10)", color: C.blue }}>
                  <Icon className="size-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-semibold text-white truncate">{p.name}</span>
                    <span style={{ color: C.muted }}>{p.count}</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: BLUE_GRAD }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyInline icon={Activity} title="No platform data yet" sub="Findings will appear grouped by source." />
      )}
    </Card>
  );
}

/* ============= HELPERS ============= */

function PeriodPill() {
  return (
    <div className="inline-flex items-center rounded-full p-1 text-xs font-semibold" style={{ background: "rgba(255,255,255,0.05)" }}>
      {["7d", "30d", "90d"].map((p, i) => (
        <span key={p} className="px-3 py-1 rounded-full transition-colors"
          style={i === 0 ? { background: C.blue, color: "#fff" } : { color: C.muted }}>
          {p}
        </span>
      ))}
    </div>
  );
}

function MiniRing({ value }: { value: number | null }) {
  const v = value ?? 0;
  const r = 42;
  const c = 2 * Math.PI * r;
  const off = c - (v / 100) * c;
  return (
    <div className="relative size-[112px] shrink-0">
      <svg viewBox="0 0 110 110" className="size-full -rotate-90">
        <circle cx="55" cy="55" r={r} strokeWidth="9" stroke="rgba(255,255,255,0.07)" fill="none" />
        <circle cx="55" cy="55" r={r} strokeWidth="9" stroke={C.blue} fill="none"
          strokeDasharray={c} strokeDashoffset={value === null ? c : off} strokeLinecap="round"
          style={{ filter: value === null ? "none" : "drop-shadow(0 0 6px rgba(30,136,255,0.6))", transition: "stroke-dashoffset 600ms ease" }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <div className="text-3xl font-bold font-display leading-none text-white">{value === null ? "—" : v}</div>
          <div className="text-[10px] mt-1" style={{ color: C.muted }}>/100</div>
        </div>
      </div>
    </div>
  );
}

function RadialGauge({ value }: { value: number }) {
  const r = 34, c = 2 * Math.PI * r, off = c - (value / 100) * c;
  return (
    <div className="relative mx-auto mt-4 size-[110px]">
      <svg viewBox="0 0 90 90" className="size-full -rotate-90">
        <circle cx="45" cy="45" r={r} strokeWidth="8" stroke="rgba(255,255,255,0.18)" fill="none" />
        <circle cx="45" cy="45" r={r} strokeWidth="8" stroke="#fff" fill="none"
          strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 600ms ease" }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center text-white">
          <div className="text-xs font-semibold opacity-80">MOMENTUM</div>
        </div>
      </div>
    </div>
  );
}

function EmptyInline({ icon: Icon, title, sub, cta }: { icon: any; title: string; sub: string; cta?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-2xl border border-dashed p-5" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
      <div className="size-9 rounded-xl grid place-items-center" style={{ background: "rgba(30,136,255,0.10)", color: C.blue }}>
        <Icon className="size-4" />
      </div>
      <div className="text-sm font-semibold text-white">{title}</div>
      <div className="text-xs" style={{ color: C.muted }}>{sub}</div>
      {cta && <div className="mt-2">{cta}</div>}
    </div>
  );
}

/* ============= DATA TRANSFORMS ============= */

type TrendPoint = { label: string; count: number };
type PlatformPoint = { name: string; count: number };

function buildTrend(timeline: { time: string }[]): TrendPoint[] {
  const days = 7;
  const buckets = new Map<string, number>();
  const now = new Date();
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const k = d.toLocaleDateString([], { weekday: "short" });
    keys.push(k);
    buckets.set(k, 0);
  }
  for (const e of timeline) {
    const d = new Date(e.time);
    const k = d.toLocaleDateString([], { weekday: "short" });
    if (buckets.has(k)) buckets.set(k, (buckets.get(k) ?? 0) + 1);
  }
  return keys.map((k) => ({ label: k, count: buckets.get(k) ?? 0 }));
}

function buildPlatform(hotspots: { label: string; count: number }[]): PlatformPoint[] {
  return hotspots.map((h) => ({ name: h.label, count: h.count }));
}
