import type { ReactNode } from "react";

const SEGMENTS = 60;

/**
 * Segmented radial progress ring around a circular viewport.
 * `progress` is driven only by real backend milestones.
 */
export function FaceScanRing({
  progress,
  active,
  tone = "cyan",
  children,
  className = "",
}: {
  progress: number;
  active?: boolean;
  tone?: "cyan" | "emerald" | "amber";
  children: ReactNode;
  className?: string;
}) {
  const filled = Math.round((Math.max(0, Math.min(100, progress)) / 100) * SEGMENTS);
  const stroke =
    tone === "emerald"
      ? "rgb(52 211 153)"
      : tone === "amber"
        ? "rgb(251 191 36)"
        : "rgb(56 189 248)";

  return (
    <div className={`relative aspect-square w-full max-w-[360px] mx-auto ${className}`}>
      {/* concentric ambient rings */}
      <div className="absolute inset-0 rounded-full border border-white/5" />
      <div className="absolute inset-[6%] rounded-full border border-white/5" />
      <div
        className="absolute inset-[3%] rounded-full"
        style={{ boxShadow: `0 0 60px -12px ${stroke}`, opacity: active ? 0.9 : 0.45 }}
      />

      {/* segmented ring */}
      <svg viewBox="0 0 200 200" className="absolute inset-0 size-full -rotate-90">
        {Array.from({ length: SEGMENTS }).map((_, i) => {
          const angle = (i / SEGMENTS) * Math.PI * 2;
          const r1 = 92;
          const r2 = 99;
          const on = i < filled;
          const leading = on && i === filled - 1;
          return (
            <line
              key={i}
              x1={100 + Math.cos(angle) * r1}
              y1={100 + Math.sin(angle) * r1}
              x2={100 + Math.cos(angle) * r2}
              y2={100 + Math.sin(angle) * r2}
              stroke={on ? stroke : "rgba(255,255,255,0.12)"}
              strokeWidth={leading ? 3.4 : 2.2}
              strokeLinecap="round"
              style={leading ? { filter: `drop-shadow(0 0 6px ${stroke})` } : undefined}
            />
          );
        })}
      </svg>

      {/* viewport */}
      <div className="absolute inset-[9%] rounded-full overflow-hidden bg-black border border-white/10">
        {children}
        {/* face guide */}
        <div className="pointer-events-none absolute inset-[14%] rounded-[50%] border border-dashed border-white/15" />
        {active && (
          <div
            className="pointer-events-none absolute inset-x-0 h-16 face-scan-sweep"
            style={{
              background: `linear-gradient(to bottom, transparent, ${stroke}59, transparent)`,
            }}
          />
        )}
      </div>

      <div className="absolute inset-0 grid place-items-end pb-1 pointer-events-none">
        <span
          className="text-xs font-mono tracking-[0.2em] text-white/60"
          data-testid="face-scan-progress"
        >
          {Math.round(progress)}%
        </span>
      </div>
    </div>
  );
}
