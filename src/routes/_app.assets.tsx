import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useData, type Asset } from "@/lib/data-store";
import { PageCard, Pill, StatCard } from "@/components/dashboard/PageCard";
import { Plus, Search, Image, Video, Music, FileText, Sparkles } from "lucide-react";

export const Route = createFileRoute("/_app/assets")({
  head: () => ({ meta: [{ title: "Assets — Eterna AI" }, { name: "description", content: "Register and monitor your protected digital assets." }] }),
  component: AssetsPage,
});

const iconFor = (t: Asset["type"]) => t === "Image" ? Image : t === "Video" ? Video : t === "Audio" ? Music : t === "Document" ? FileText : Sparkles;

function AssetsPage() {
  const { assets, addAsset } = useData();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ name: string; type: Asset["type"]; platform: string; status: Asset["status"] }>({ name: "", type: "Image", platform: "Web", status: "Protected" });

  const filtered = assets.filter((a) => a.name.toLowerCase().includes(q.toLowerCase()) || a.platform.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="TOTAL ASSETS" value={assets.length} sub="Registered assets" />
        <StatCard label="PROTECTED" value={assets.filter(a=>a.status==="Protected").length} sub="Actively defended" accent="oklch(0.68 0.16 155)" />
        <StatCard label="MONITORING" value={assets.filter(a=>a.status==="Monitoring").length} sub="Under watch" accent="oklch(0.75 0.16 70)" />
        <StatCard label="AT RISK" value={assets.filter(a=>a.status==="At Risk").length} sub="Immediate attention" accent="oklch(0.63 0.24 25)" />
      </div>

      <PageCard
        title="ASSET REGISTRY"
        sub="Copyright-registered and AI-fingerprinted assets"
        actions={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Search assets..." className="pl-9 pr-3 py-2 rounded-lg border border-border bg-card text-sm w-56 focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
            <button onClick={()=>setOpen(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-white text-sm font-semibold" style={{ background: "var(--gradient-brand)" }}>
              <Plus className="size-4" /> Register Asset
            </button>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="py-2.5 pr-4 font-medium">Asset</th>
                <th className="py-2.5 pr-4 font-medium">Type</th>
                <th className="py-2.5 pr-4 font-medium">Platform</th>
                <th className="py-2.5 pr-4 font-medium">Registered</th>
                <th className="py-2.5 pr-4 font-medium">Status</th>
                <th className="py-2.5 font-medium">ID</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => {
                const Icon = iconFor(a.type);
                const color = a.status === "Protected" ? "oklch(0.68 0.16 155)" : a.status === "Monitoring" ? "oklch(0.75 0.16 70)" : "oklch(0.63 0.24 25)";
                return (
                  <tr key={a.id} className="border-b border-border/60 hover:bg-accent/30">
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-3">
                        <div className="size-9 rounded-lg grid place-items-center bg-primary/10 text-primary"><Icon className="size-4" /></div>
                        <div className="font-medium">{a.name}</div>
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">{a.type}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{a.platform}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{a.registered}</td>
                    <td className="py-3 pr-4"><Pill color={color}>{a.status}</Pill></td>
                    <td className="py-3 text-xs text-muted-foreground font-mono">{a.id}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </PageCard>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/30 grid place-items-center p-4" onClick={()=>setOpen(false)}>
          <div className="card-surface p-6 w-full max-w-md" onClick={(e)=>e.stopPropagation()}>
            <div className="text-lg font-display font-bold">Register a new asset</div>
            <div className="text-sm text-muted-foreground mb-4">Fingerprint and copyright-register your content.</div>
            <div className="space-y-3">
              <label className="block text-xs font-semibold">Name
                <input value={form.name} onChange={(e)=>setForm({...form, name:e.target.value})} className="mt-1 w-full px-3 py-2 rounded-lg border border-border text-sm" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-semibold">Type
                  <select value={form.type} onChange={(e)=>setForm({...form, type: e.target.value as Asset["type"]})} className="mt-1 w-full px-3 py-2 rounded-lg border border-border text-sm bg-card">
                    {["Image","Video","Audio","Document","Brand"].map(t=><option key={t}>{t}</option>)}
                  </select>
                </label>
                <label className="block text-xs font-semibold">Platform
                  <input value={form.platform} onChange={(e)=>setForm({...form, platform:e.target.value})} className="mt-1 w-full px-3 py-2 rounded-lg border border-border text-sm" />
                </label>
              </div>
              <label className="block text-xs font-semibold">Status
                <select value={form.status} onChange={(e)=>setForm({...form, status: e.target.value as Asset["status"]})} className="mt-1 w-full px-3 py-2 rounded-lg border border-border text-sm bg-card">
                  {["Protected","Monitoring","At Risk"].map(t=><option key={t}>{t}</option>)}
                </select>
              </label>
            </div>
            <div className="flex gap-2 mt-5 justify-end">
              <button onClick={()=>setOpen(false)} className="px-4 py-2 rounded-lg border border-border text-sm font-medium">Cancel</button>
              <button
                onClick={()=>{ if(form.name.trim()){ addAsset(form); setOpen(false); setForm({ name: "", type: "Image", platform: "Web", status: "Protected" }); }}}
                className="px-4 py-2 rounded-lg text-white text-sm font-semibold" style={{ background: "var(--gradient-brand)" }}
              >Register</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
