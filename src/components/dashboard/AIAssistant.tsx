import { X, Search, UserSearch, Package, FileText, FileEdit, Send } from "lucide-react";
import robot from "@/assets/ai-assistant.png";

const actions = [
  { icon: Search, label: "Show highest risk threats" },
  { icon: UserSearch, label: "Find impersonation accounts" },
  { icon: Package, label: "Generate takedown package" },
  { icon: FileText, label: "Create legal report" },
  { icon: FileEdit, label: "Draft DMCA notice" },
];

export function AIAssistant() {
  return (
    <aside className="w-[300px] shrink-0 card-surface p-5 flex flex-col" style={{ background: "var(--gradient-soft)" }}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground">AI ASSISTANT</div>
          <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-semibold mt-1"><span className="size-1.5 rounded-full bg-emerald-500" /> Online</div>
        </div>
        <button className="size-7 grid place-items-center rounded-md text-muted-foreground hover:bg-white/60"><X className="size-4" /></button>
      </div>

      <div className="my-4 grid place-items-center">
        <img src={robot} alt="Eterna AI Assistant" width={512} height={512} loading="lazy" className="size-40 object-contain drop-shadow-xl" />
      </div>

      <div className="text-center">
        <div className="text-lg font-display font-bold">Hello, Sreehari</div>
        <div className="text-sm text-muted-foreground mt-1">How can I help protect your <span className="font-semibold text-primary">reputation</span> today?</div>
      </div>

      <div className="mt-4 space-y-2">
        {actions.map((a) => {
          const Icon = a.icon;
          return (
            <button key={a.label} className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white/70 hover:bg-white text-sm text-left transition">
              <Icon className="size-4 text-primary" />
              <span className="truncate">{a.label}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-auto pt-4">
        <div className="relative">
          <input placeholder="Ask anything..." className="w-full pl-4 pr-11 py-3 rounded-2xl bg-white border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
          <button className="absolute right-1.5 top-1/2 -translate-y-1/2 size-9 grid place-items-center rounded-xl text-white" style={{ background: "var(--gradient-brand)" }}>
            <Send className="size-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
