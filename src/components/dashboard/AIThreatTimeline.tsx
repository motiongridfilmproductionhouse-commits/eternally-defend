import { Youtube, Brain, FileImage, Send, Plus } from "lucide-react";

const events = [
  { time: "08:23 AM", icon: Youtube, color: "oklch(0.63 0.24 25)", title: "YouTube video detected", sub: "Potential reputation risk" },
  { time: "08:24 AM", icon: Brain, color: "oklch(0.6 0.24 295)", title: "AI classified as risk", sub: "Confidence: 92%" },
  { time: "08:26 AM", icon: FileImage, color: "oklch(0.65 0.18 240)", title: "Evidence captured", sub: "Screenshots, metadata, links" },
  { time: "08:28 AM", icon: Send, color: "oklch(0.68 0.16 155)", title: "Takedown prepared", sub: "DMCA notice generated" },
  { time: "08:31 AM", icon: Plus, color: "oklch(0.7 0.18 320)", title: "Case created", sub: "ID: CASE-2025-0622-0012" },
];

export function AIThreatTimeline() {
  return (
    <div className="card-surface p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground">AI THREAT TIMELINE</div>
          <div className="text-xs text-muted-foreground/80">Real-time events</div>
        </div>
        <button className="text-xs font-semibold text-primary">View All</button>
      </div>
      <div className="relative pl-4">
        <div className="absolute left-[7px] top-1 bottom-1 w-px bg-border" />
        <div className="space-y-4">
          {events.map((e) => {
            const Icon = e.icon;
            return (
              <div key={e.time} className="relative flex items-start gap-3">
                <span className="absolute -left-4 top-1.5 size-3 rounded-full ring-4 ring-background" style={{ background: e.color }} />
                <div className="text-xs font-semibold text-muted-foreground w-16 shrink-0 pt-0.5">{e.time}</div>
                <div className="size-8 rounded-lg grid place-items-center shrink-0" style={{ background: `color-mix(in oklab, ${e.color} 12%, white)`, color: e.color }}>
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold leading-tight">{e.title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">{e.sub}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
