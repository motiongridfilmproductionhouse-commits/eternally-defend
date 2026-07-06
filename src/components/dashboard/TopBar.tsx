import { Search, Sparkles, Bell, MoreVertical, ChevronDown } from "lucide-react";

export function TopBar() {
  return (
    <header className="flex items-center gap-4 px-6 py-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-display font-bold tracking-tight">Protection Command Center</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Real-time reputation protection & threat intelligence</p>
      </div>
      <div className="flex-1 max-w-xl ml-auto">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            placeholder="Search assets, cases, URLs, identities..."
            className="w-full pl-11 pr-4 py-3 rounded-2xl bg-card border border-border text-sm placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
      </div>
      <button className="flex items-center gap-2 px-4 py-3 rounded-2xl border border-border bg-card text-sm font-semibold hover:bg-accent transition">
        <Sparkles className="size-4 text-primary" /> Quick Action <ChevronDown className="size-4 text-muted-foreground" />
      </button>
      <button className="relative size-11 grid place-items-center rounded-2xl border border-border bg-card">
        <Bell className="size-[18px]" />
        <span className="absolute top-1 right-1 min-w-4 h-4 px-1 text-[10px] font-bold text-white rounded-full grid place-items-center" style={{ background: "var(--gradient-brand)" }}>3</span>
      </button>
      <button className="size-11 grid place-items-center rounded-2xl border border-border bg-card">
        <MoreVertical className="size-[18px]" />
      </button>
    </header>
  );
}
