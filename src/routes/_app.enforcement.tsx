import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useData } from "@/lib/data-store";
import { PageCard, StatCard } from "@/components/dashboard/PageCard";
import { Send, FileText, Scale, ShieldCheck, ShieldAlert } from "lucide-react";
import { useAuthorization } from "@/hooks/use-authorization";
import { Button } from "@/components/ui/button";


export const Route = createFileRoute("/_app/enforcement")({
  head: () => ({ meta: [{ title: "Enforcement — Eterna AI" }] }),
  component: EnforcementPage,
});

const actions = [
  { icon: Send, title: "Send DMCA takedown", tone: "oklch(0.55 0.22 295)" },
  { icon: FileText, title: "File platform report", tone: "oklch(0.65 0.18 240)" },
  { icon: Scale, title: "Escalate to legal", tone: "oklch(0.63 0.24 25)" },
  { icon: ShieldCheck, title: "Add to protected set", tone: "oklch(0.68 0.16 155)" },
];

function EnforcementPage() {
  const { threats, addRemoval, updateThreatStatus } = useData();
  const [selected, setSelected] = useState<string[]>([]);
  const authz = useAuthorization();

  const toggle = (id: string) => setSelected((s) => s.includes(id) ? s.filter((x)=>x!==id) : [...s, id]);

  const enforce = (method: "DMCA" | "Platform Report" | "Legal Notice") => {
    if (!authz.canRequestEnforcement) return;
    selected.forEach((id) => {
      const t = threats.find((x) => x.id === id);
      if (t) {
        addRemoval({ url: `${t.platform.toLowerCase()}.com/${t.id}`, platform: t.platform, method });
        updateThreatStatus(id, "Takedown Sent");
      }
    });
    setSelected([]);
  };

  return (
    <div className="space-y-5">
      {!authz.canRequestEnforcement && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-center gap-3">
          <ShieldAlert className="size-5 text-amber-700" />
          <div className="flex-1 text-sm text-amber-900">
            Enforcement actions are disabled. Your current authorization level does not include enforcement requests.
          </div>
          <Button asChild size="sm" variant="outline"><Link to="/onboarding">Update authorization</Link></Button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="TAKEDOWNS SENT" value="1,247" sub="All time" accent="oklch(0.65 0.18 240)" />
        <StatCard label="SUCCESS RATE" value="94%" sub="Removed on first attempt" accent="oklch(0.68 0.16 155)" />
        <StatCard label="AVG RESPONSE" value="6.2h" sub="Platform response time" accent="oklch(0.55 0.22 295)" />
        <StatCard label="LEGAL ESCALATIONS" value="18" sub="This month" accent="oklch(0.63 0.24 25)" />
      </div>

      <PageCard title="QUICK ACTIONS" sub="Apply enforcement to selected threats">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {actions.map((a) => {
            const Icon = a.icon;
            return (
              <button
                key={a.title}
                onClick={() => enforce(a.title.includes("DMCA") ? "DMCA" : a.title.includes("platform") ? "Platform Report" : "Legal Notice")}
                disabled={!authz.canRequestEnforcement || (selected.length===0 && !a.title.includes("protected"))}
                className="border border-border rounded-xl p-4 text-left hover:bg-accent/40 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="size-10 rounded-xl grid place-items-center mb-3" style={{ background: `color-mix(in oklab, ${a.tone} 14%, white)`, color: a.tone }}>
                  <Icon className="size-5" />
                </div>
                <div className="font-semibold text-sm">{a.title}</div>
                <div className="text-xs text-muted-foreground mt-1">{selected.length} selected</div>
              </button>
            );
          })}
        </div>
      </PageCard>

      <PageCard title="ELIGIBLE THREATS" sub="Select items to enforce against">
        <div className="space-y-2">
          {threats.map((t) => (
            <label key={t.id} className="flex items-center gap-3 p-3 border border-border rounded-xl cursor-pointer hover:bg-accent/30">
              <input type="checkbox" checked={selected.includes(t.id)} onChange={()=>toggle(t.id)} className="size-4 accent-primary" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate">{t.title}</div>
                <div className="text-xs text-muted-foreground">{t.platform} · {t.riskType} · {t.severity}</div>
              </div>
              <span className="text-xs text-muted-foreground">{t.status}</span>
            </label>
          ))}
        </div>
      </PageCard>
    </div>
  );
}
