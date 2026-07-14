import { ShieldAlert, Facebook, Youtube, Music2 } from "lucide-react";

export function UnauthorizedUsage() {
  return (
    <div className="card-surface p-5 flex flex-col">
      <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground">UNAUTHORIZED USAGE</div>
      <div className="text-xs text-muted-foreground/80 mb-4">Brand & image misuse</div>

      <div className="flex items-center gap-3">
        <div className="size-12 rounded-xl grid place-items-center bg-primary/10 text-primary shrink-0">
          <ShieldAlert className="size-6" />
        </div>
        <div className="min-w-0">
          <div className="text-2xl font-bold font-display leading-none">14</div>
          <div className="text-[11px] text-muted-foreground mt-1">Unauthorized Ads</div>
        </div>
      </div>

      <div className="mt-4">
        <div className="text-[10px] tracking-widest text-muted-foreground mb-2">Platforms</div>
        <div className="flex gap-2">
          <div className="size-9 rounded-lg grid place-items-center bg-blue-100 text-blue-600"><Facebook className="size-4" /></div>
          <div className="size-9 rounded-lg grid place-items-center bg-red-100 text-red-600"><Youtube className="size-4" /></div>
          <div className="size-9 rounded-lg grid place-items-center bg-gray-100 text-gray-800"><Music2 className="size-4" /></div>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-border">
        <div className="text-[10px] tracking-widest text-muted-foreground">Est. Revenue Lost</div>
        <div className="text-xl font-bold font-display text-rose-500 mt-1">$24,500</div>
      </div>

      <button className="mt-4 w-full text-sm font-semibold py-2 rounded-lg border border-border hover:bg-accent transition">View Cases</button>
    </div>
  );
}
