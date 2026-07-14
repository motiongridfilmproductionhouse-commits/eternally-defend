import { type ReactNode } from "react";

export function PageCard({ title, sub, children, actions }: { title?: string; sub?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="card-surface card-hover p-6">
      {(title || actions) && (
        <div className="flex items-center justify-between mb-5">
          <div>
            {title && <div className="text-[10px] tracking-[0.2em] font-semibold text-muted-foreground uppercase">{title}</div>}
            {sub && <div className="text-xs text-muted-foreground/80 mt-1">{sub}</div>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

export function StatCard({ label, value, sub, accent = "#3D9BFF" }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div className="card-surface card-hover p-6">
      <div className="text-[10px] tracking-[0.2em] font-semibold text-muted-foreground uppercase">{label}</div>
      <div className="mt-3 text-3xl font-display font-bold tracking-tight" style={{ color: accent }}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1.5">{sub}</div>}
    </div>
  );
}

export function Pill({ children, color = "#3D9BFF" }: { children: ReactNode; color?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full border"
      style={{ background: `color-mix(in oklab, ${color} 16%, transparent)`, color, borderColor: `color-mix(in oklab, ${color} 32%, transparent)` }}
    >
      {children}
    </span>
  );
}

