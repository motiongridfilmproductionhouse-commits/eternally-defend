import { type ReactNode } from "react";

export function PageCard({ title, sub, children, actions }: { title?: string; sub?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="card-surface p-5">
      {(title || actions) && (
        <div className="flex items-center justify-between mb-4">
          <div>
            {title && <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground">{title}</div>}
            {sub && <div className="text-xs text-muted-foreground/80 mt-0.5">{sub}</div>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

export function StatCard({ label, value, sub, accent = "oklch(0.55 0.22 295)" }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div className="card-surface p-5">
      <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground">{label}</div>
      <div className="mt-2 text-3xl font-display font-bold" style={{ color: accent }}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

export function Pill({ children, color = "oklch(0.55 0.22 295)" }: { children: ReactNode; color?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full"
      style={{ background: `color-mix(in oklab, ${color} 14%, white)`, color }}
    >
      {children}
    </span>
  );
}
