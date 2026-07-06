const items = [
  { n: 1, title: "Deepfake Video Spreading", sub: "YouTube, TikTok", score: 9.8, tag: "Critical", color: "oklch(0.63 0.24 25)" },
  { n: 2, title: "False News Article", sub: "News Portal", score: 8.6, tag: "High", color: "oklch(0.7 0.2 35)" },
  { n: 3, title: "Impersonation Account", sub: "Instagram", score: 7.4, tag: "High", color: "oklch(0.75 0.16 70)" },
  { n: 4, title: "Unauthorized Ad Campaign", sub: "Meta Ads", score: 6.9, tag: "Medium", color: "oklch(0.68 0.16 155)" },
];

export function TopActiveThreats() {
  return (
    <div className="card-surface p-5">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground">TOP ACTIVE THREATS</div>
        <button className="text-xs font-semibold text-primary">View All</button>
      </div>
      <div className="text-xs text-muted-foreground/80 mb-4">By severity</div>
      <div className="space-y-3">
        {items.map((t) => (
          <div key={t.n} className="flex items-center gap-3">
            <div className="size-6 rounded-full grid place-items-center text-[11px] font-bold text-white shrink-0" style={{ background: t.color }}>{t.n}</div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold leading-tight truncate">{t.title}</div>
              <div className="text-[11px] text-muted-foreground truncate">{t.sub}</div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-sm font-bold" style={{ color: t.color }}>{t.score}</div>
              <div className="text-[10px] text-muted-foreground">{t.tag}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
