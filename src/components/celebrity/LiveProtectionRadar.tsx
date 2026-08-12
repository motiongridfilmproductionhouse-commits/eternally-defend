import { Radar, ShieldCheck } from "lucide-react";
import type { RadarColor, RadarFinding } from "@/lib/celebrity/radar-model";

const NODE_CLASS: Record<RadarColor, string> = {
  green: "bg-emerald-400 shadow-[0_0_10px_2px_rgba(52,211,153,0.55)]",
  yellow: "bg-amber-300 shadow-[0_0_10px_2px_rgba(252,211,77,0.5)]",
  orange: "bg-orange-400 shadow-[0_0_12px_3px_rgba(251,146,60,0.55)]",
  red: "bg-red-500 cyber-blip-hot shadow-[0_0_14px_4px_rgba(239,68,68,0.6)]",
};

const LEGEND: Array<{ color: RadarColor; label: string }> = [
  { color: "green", label: "Authorized / clear" },
  { color: "yellow", label: "Needs review" },
  { color: "orange", label: "Suspicious" },
  { color: "red", label: "Verified threat" },
];

export type LiveProtectionRadarProps = {
  nodes: RadarFinding[];
  scanning: boolean;
  protection: "ACTIVE" | "SETUP_REQUIRED";
  counters: Array<{ label: string; value: number }>;
  onSelect: (finding: RadarFinding) => void;
};

/**
 * Large protection radar. Every blip is a persisted finding — placement is
 * derived deterministically from the finding id, never randomised.
 */
export function LiveProtectionRadar({
  nodes,
  scanning,
  protection,
  counters,
  onSelect,
}: LiveProtectionRadarProps) {
  return (
    <section className="cyber-panel relative overflow-hidden rounded-2xl p-5">
      <div className="pointer-events-none absolute inset-0 cyber-grid opacity-40" />

      <header className="relative flex flex-wrap items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-xl border border-sky-400/40 bg-sky-500/10">
          <Radar className={`h-4 w-4 text-sky-300 ${scanning ? "animate-pulse" : ""}`} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-slate-100">Live Protection Radar</h2>
          <p className="text-[11px] text-sky-300/80">
            {nodes.length === 0
              ? "No findings recorded yet — monitoring continues."
              : `${nodes.length} tracked finding${nodes.length === 1 ? "" : "s"} from your scans`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
            <ShieldCheck className="h-3.5 w-3.5" />
            Protection: {protection === "ACTIVE" ? "ACTIVE" : "SETUP REQUIRED"}
          </span>
          <span className="rounded-full border border-sky-400/30 bg-sky-500/10 px-2.5 py-1 font-mono text-[11px] uppercase tracking-widest text-sky-300">
            Radar: {scanning ? "Scanning" : "Idle"}
          </span>
        </div>
      </header>

      <div className="relative mt-5 grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
        <div className="relative mx-auto aspect-square w-full max-w-[420px]">
          <div className="absolute inset-0 rounded-full border border-sky-400/25 bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.12),transparent_65%)]" />
          <div className="absolute inset-[12%] rounded-full border border-sky-400/20" />
          <div className="absolute inset-[26%] rounded-full border border-sky-400/15" />
          <div className="absolute inset-[40%] rounded-full border border-sky-400/12" />
          <div className="absolute inset-[54%] rounded-full border border-sky-400/10" />
          <div className="absolute left-1/2 top-0 h-full w-px bg-sky-400/10" />
          <div className="absolute left-0 top-1/2 h-px w-full bg-sky-400/10" />
          <span className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-300 shadow-[0_0_18px_6px_rgba(56,189,248,0.55)]" />
          {scanning && (
            <>
              <div className="cyber-radar-sweep absolute inset-0 rounded-full" />
              <span className="cyber-radar-ping absolute inset-0 rounded-full border border-sky-400/30" />
            </>
          )}

          {nodes.map((node) => (
            <button
              key={`${node.kind}:${node.id}`}
              type="button"
              onClick={() => onSelect(node)}
              title={`${node.category} · ${node.platform}`}
              aria-label={`${node.category} on ${node.platform} — open evidence`}
              className={`absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform hover:scale-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${NODE_CLASS[node.color]}`}
              style={{
                left: `${50 + Math.cos((node.angle * Math.PI) / 180) * node.radius}%`,
                top: `${50 + Math.sin((node.angle * Math.PI) / 180) * node.radius}%`,
              }}
            />
          ))}
        </div>

        <div className="min-w-0 space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {counters.map((c) => (
              <div
                key={c.label}
                className="rounded-lg border border-sky-400/20 bg-sky-500/5 px-2.5 py-2"
              >
                <div className="text-lg font-semibold text-slate-100">{c.value}</div>
                <div className="text-[10px] uppercase tracking-wide text-sky-300/70">{c.label}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-3">
            {LEGEND.map((l) => (
              <span
                key={l.color}
                className="inline-flex items-center gap-1.5 text-[11px] text-slate-300"
              >
                <span className={`h-2 w-2 rounded-full ${NODE_CLASS[l.color]}`} />
                {l.label}
              </span>
            ))}
          </div>

          <p className="text-[11px] leading-relaxed text-sky-300/70">
            Findings are classified by the existing evidence pipeline. A likeness match alone is
            never reported as a confirmed threat.
          </p>
        </div>
      </div>
    </section>
  );
}

export default LiveProtectionRadar;
