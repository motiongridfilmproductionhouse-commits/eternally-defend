import { Youtube, Instagram, Music2, MessageCircle, Newspaper, Twitter } from "lucide-react";

const items = [
  { icon: Youtube, name: "YouTube", count: 67, color: "oklch(0.63 0.24 25)" },
  { icon: Instagram, name: "Instagram", count: 32, color: "oklch(0.65 0.22 340)" },
  { icon: Music2, name: "TikTok", count: 18, color: "oklch(0.3 0.05 275)" },
  { icon: MessageCircle, name: "Reddit", count: 15, color: "oklch(0.68 0.2 35)" },
  { icon: Newspaper, name: "News Sites", count: 24, color: "oklch(0.65 0.18 240)" },
  { icon: Twitter, name: "X (Twitter)", count: 11, color: "oklch(0.3 0.02 275)" },
];

export function PlatformIntelligence() {
  return (
    <div className="card-surface p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground">PLATFORM INTELLIGENCE</div>
          <div className="text-xs text-muted-foreground/80">Findings by platform</div>
        </div>
        <button className="text-xs font-semibold text-primary">View All</button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {items.map((p) => {
          const Icon = p.icon;
          return (
            <div key={p.name} className="border border-border rounded-xl p-3 flex items-center gap-2.5">
              <div className="size-9 rounded-lg grid place-items-center" style={{ background: `color-mix(in oklab, ${p.color} 12%, white)`, color: p.color }}>
                <Icon className="size-4" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold truncate">{p.name}</div>
                <div className="text-[11px] text-muted-foreground"><span className="font-semibold text-foreground">{p.count}</span> Findings</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
