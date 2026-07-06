import { ShieldAlert, Facebook, Youtube, Music2 } from "lucide-react";

export function UnauthorizedUsage() {
  return (
    <div className="card-surface p-5">
      <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground">UNAUTHORIZED USAGE DETECTION</div>
      <div className="text-xs text-muted-foreground/80 mb-4">Brand & image misuse</div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col items-center text-center">
          <div className="size-14 rounded-xl grid place-items-center bg-primary/10 text-primary mb-2">
            <ShieldAlert className="size-6" />
          </div>
          <div className="text-[10px] tracking-widest text-muted-foreground">Detected</div>
          <div className="text-2xl font-bold font-display">14</div>
          <div className="text-[11px] text-muted-foreground">Unauthorized Ads</div>
        </div>
        <div>
          <div className="text-[10px] tracking-widest text-muted-foreground mb-2">Platforms</div>
          <div className="flex gap-2">
            <div className="size-10 rounded-lg grid place-items-center bg-blue-100 text-blue-600"><Facebook className="size-5" /></div>
            <div className="size-10 rounded-lg grid place-items-center bg-red-100 text-red-600"><Youtube className="size-5" /></div>
            <div className="size-10 rounded-lg grid place-items-center bg-gray-100 text-gray-800"><Music2 className="size-5" /></div>
          </div>
          <div className="mt-4">
            <div className="text-[10px] tracking-widest text-muted-foreground">Est. Revenue Lost</div>
            <div className="text-xl font-bold font-display text-rose-500">$24,500</div>
          </div>
        </div>
      </div>
      <button className="mt-4 w-full text-sm font-semibold py-2 rounded-lg border border-border hover:bg-accent transition">View Cases</button>
    </div>
  );
}
