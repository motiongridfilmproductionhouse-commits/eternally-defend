import { Youtube, Instagram, Music2, MessageCircle, Newspaper, Twitter } from "lucide-react";

const items = [
  { icon: Youtube, name: "YouTube", count: 67, color: "#FF4D4D" },
  { icon: Instagram, name: "Instagram", count: 32, color: "#E879F9" },
  { icon: Music2, name: "TikTok", count: 18, color: "#22D3EE" },
  { icon: MessageCircle, name: "Reddit", count: 15, color: "#FB923C" },
  { icon: Newspaper, name: "News Sites", count: 24, color: "#3B82F6" },
  { icon: Twitter, name: "X (Twitter)", count: 11, color: "#93C5FD" },
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
