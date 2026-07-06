import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageCard } from "@/components/dashboard/PageCard";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_app/settings")({
  head: () => ({ meta: [{ title: "Settings — Eterna AI" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const [prefs, setPrefs] = useState({
    autoTakedown: true,
    weeklyDigest: true,
    smsAlerts: false,
    deepfakeAlerts: true,
    aiSuggestions: true,
    legalEscalation: false,
  });

  return (
    <div className="space-y-5 max-w-3xl">
      <PageCard title="ACCOUNT" sub="Basic profile information">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="text-xs font-semibold">Full name<input defaultValue="Sreehari" className="mt-1 w-full px-3 py-2 rounded-lg border border-border text-sm" /></label>
          <label className="text-xs font-semibold">Email<input defaultValue="sreehari@eterna.ai" className="mt-1 w-full px-3 py-2 rounded-lg border border-border text-sm" /></label>
          <label className="text-xs font-semibold">Organization<input defaultValue="Eterna Labs" className="mt-1 w-full px-3 py-2 rounded-lg border border-border text-sm" /></label>
          <label className="text-xs font-semibold">Role<input defaultValue="Founder" className="mt-1 w-full px-3 py-2 rounded-lg border border-border text-sm" /></label>
        </div>
      </PageCard>

      <PageCard title="PLAN" sub="Elite Protection">
        <div className="rounded-xl p-4 flex items-center gap-4" style={{ background: "var(--gradient-soft)" }}>
          <div className="size-12 rounded-2xl grid place-items-center text-white" style={{ background: "var(--gradient-brand)" }}>★</div>
          <div className="flex-1">
            <div className="font-semibold">Elite Protection</div>
            <div className="text-xs text-muted-foreground">Unlimited monitoring, DMCA automation, deepfake AI, legal escalation.</div>
          </div>
          <button className="px-4 py-2 rounded-lg bg-white text-sm font-semibold border border-border">Manage</button>
        </div>
      </PageCard>

      <PageCard title="PREFERENCES" sub="Automation and alerts">
        <div className="space-y-3">
          {Object.entries(prefs).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between py-1">
              <div>
                <div className="text-sm font-semibold capitalize">{k.replace(/([A-Z])/g, " $1")}</div>
                <div className="text-xs text-muted-foreground">Toggle {k.replace(/([A-Z])/g, " $1").toLowerCase()}.</div>
              </div>
              <Switch checked={v} onCheckedChange={(nv)=>setPrefs((p)=>({...p, [k]: nv}))} />
            </div>
          ))}
        </div>
      </PageCard>
    </div>
  );
}
