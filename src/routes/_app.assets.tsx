import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { PageCard, Pill, StatCard } from "@/components/dashboard/PageCard";
import { Plus, Search, Image as ImageIcon, Video, Music, FileText, Sparkles, Trash2, Loader2, Radar } from "lucide-react";
import { toast } from "sonner";
import { DiscoveryPanel } from "@/components/discovery/DiscoveryPanel";


export const Route = createFileRoute("/_app/assets")({
  head: () => ({ meta: [{ title: "Assets — Eterna AI" }, { name: "description", content: "Register and monitor your protected digital assets." }] }),
  component: AssetsPage,
});

type AssetKind = "image" | "video" | "audio" | "document" | "brand";
type AssetStatus = "Protected" | "Monitoring" | "At Risk";

interface AssetRow {
  id: string;
  name: string;
  kind: string;
  source_url: string | null;
  active: boolean;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

const KIND_LABEL: Record<string, string> = {
  image: "Image", video: "Video", audio: "Audio", document: "Document", brand: "Brand",
};

const iconFor = (kind: string) => {
  const k = kind.toLowerCase();
  if (k === "image") return ImageIcon;
  if (k === "video") return Video;
  if (k === "audio") return Music;
  if (k === "document") return FileText;
  return Sparkles;
};

const statusOf = (a: AssetRow): AssetStatus => {
  const s = (a.metadata?.["status"] as string | undefined) ?? (a.active ? "Protected" : "At Risk");
  if (s === "Monitoring" || s === "At Risk" || s === "Protected") return s;
  return "Protected";
};

const platformOf = (a: AssetRow): string =>
  (a.metadata?.["platform"] as string | undefined) ??
  (a.source_url ? new URL(a.source_url).hostname.replace(/^www\./, "") : "—");

function AssetsPage() {
  const { session, ready } = useSession();
  const userId = session?.user.id;
  const qc = useQueryClient();

  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ name: string; kind: AssetKind; platform: string; source_url: string; status: AssetStatus }>({
    name: "", kind: "image", platform: "", source_url: "", status: "Protected",
  });

  const assetsQuery = useQuery({
    queryKey: ["protected_assets", userId],
    enabled: ready && !!userId,
    queryFn: async (): Promise<AssetRow[]> => {
      const { data, error } = await supabase
        .from("protected_assets")
        .select("id,name,kind,source_url,active,metadata,created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AssetRow[];
    },
  });

  const addMut = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Not signed in");
      const { error } = await supabase.from("protected_assets").insert({
        user_id: userId,
        name: form.name.trim(),
        kind: form.kind,
        source_url: form.source_url.trim() || null,
        active: form.status !== "At Risk",
        metadata: { platform: form.platform.trim() || null, status: form.status },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Asset registered");
      setOpen(false);
      setForm({ name: "", kind: "image", platform: "", source_url: "", status: "Protected" });
      qc.invalidateQueries({ queryKey: ["protected_assets", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("protected_assets").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Asset removed");
      qc.invalidateQueries({ queryKey: ["protected_assets", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const assets = assetsQuery.data ?? [];
  const filtered = assets.filter((a) => {
    const needle = q.toLowerCase();
    return (
      a.name.toLowerCase().includes(needle) ||
      (a.source_url ?? "").toLowerCase().includes(needle) ||
      platformOf(a).toLowerCase().includes(needle)
    );
  });

  const counts = {
    total: assets.length,
    protected: assets.filter((a) => statusOf(a) === "Protected").length,
    monitoring: assets.filter((a) => statusOf(a) === "Monitoring").length,
    atRisk: assets.filter((a) => statusOf(a) === "At Risk").length,
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="TOTAL ASSETS" value={counts.total} sub="Registered assets" />
        <StatCard label="PROTECTED" value={counts.protected} sub="Actively defended" accent="oklch(0.68 0.16 155)" />
        <StatCard label="MONITORING" value={counts.monitoring} sub="Under watch" accent="oklch(0.75 0.16 70)" />
        <StatCard label="AT RISK" value={counts.atRisk} sub="Immediate attention" accent="oklch(0.63 0.24 25)" />
      </div>

      <PageCard
        title="ASSET REGISTRY"
        sub="Copyright-registered and AI-fingerprinted assets"
        actions={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search assets..." className="pl-9 pr-3 py-2 rounded-lg border border-border bg-card text-sm w-56 focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
            <button onClick={() => setOpen(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-white text-sm font-semibold" style={{ background: "var(--gradient-brand)" }}>
              <Plus className="size-4" /> Register Asset
            </button>
          </div>
        }
      >
        {assetsQuery.isLoading ? (
          <div className="py-16 grid place-items-center text-muted-foreground text-sm">
            <Loader2 className="size-5 animate-spin mb-2" /> Loading your assets…
          </div>
        ) : assetsQuery.isError ? (
          <div className="py-10 text-center text-sm text-destructive">
            Failed to load assets. {(assetsQuery.error as Error)?.message}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <div className="text-sm font-semibold">No protected assets yet</div>
            <div className="text-xs text-muted-foreground mt-1 mb-4">Register your first asset to start monitoring.</div>
            <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-white text-sm font-semibold" style={{ background: "var(--gradient-brand)" }}>
              <Plus className="size-4" /> Register Asset
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="py-2.5 pr-4 font-medium">Asset</th>
                  <th className="py-2.5 pr-4 font-medium">Type</th>
                  <th className="py-2.5 pr-4 font-medium">Platform</th>
                  <th className="py-2.5 pr-4 font-medium">Registered</th>
                  <th className="py-2.5 pr-4 font-medium">Status</th>
                  <th className="py-2.5 pr-4 font-medium">ID</th>
                  <th className="py-2.5 font-medium w-10"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => {
                  const Icon = iconFor(a.kind);
                  const status = statusOf(a);
                  const color = status === "Protected" ? "oklch(0.68 0.16 155)" : status === "Monitoring" ? "oklch(0.75 0.16 70)" : "oklch(0.63 0.24 25)";
                  return (
                    <tr key={a.id} className="border-b border-border/60 hover:bg-accent/30">
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-3">
                          <div className="size-9 rounded-lg grid place-items-center bg-primary/10 text-primary"><Icon className="size-4" /></div>
                          <div>
                            <div className="font-medium">{a.name}</div>
                            {a.source_url && <div className="text-xs text-muted-foreground truncate max-w-xs">{a.source_url}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground">{KIND_LABEL[a.kind.toLowerCase()] ?? a.kind}</td>
                      <td className="py-3 pr-4 text-muted-foreground">{platformOf(a)}</td>
                      <td className="py-3 pr-4 text-muted-foreground">{new Date(a.created_at).toISOString().slice(0, 10)}</td>
                      <td className="py-3 pr-4"><Pill color={color}>{status}</Pill></td>
                      <td className="py-3 pr-4 text-xs text-muted-foreground font-mono">{a.id.slice(0, 8)}</td>
                      <td className="py-3">
                        <button
                          onClick={() => { if (confirm(`Delete "${a.name}"?`)) delMut.mutate(a.id); }}
                          className="size-8 grid place-items-center rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                          title="Delete asset"
                          disabled={delMut.isPending}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </PageCard>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/30 grid place-items-center p-4" onClick={() => setOpen(false)}>
          <div className="card-surface p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="text-lg font-display font-bold">Register a new asset</div>
            <div className="text-sm text-muted-foreground mb-4">Fingerprint and copyright-register your content.</div>
            <div className="space-y-3">
              <label className="block text-xs font-semibold">Name
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-border text-sm" placeholder="Brand Logo v3" />
              </label>
              <label className="block text-xs font-semibold">Source URL (optional)
                <input value={form.source_url} onChange={(e) => setForm({ ...form, source_url: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-border text-sm" placeholder="https://…" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-semibold">Type
                  <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as AssetKind })} className="mt-1 w-full px-3 py-2 rounded-lg border border-border text-sm bg-card">
                    {(["image", "video", "audio", "document", "brand"] as AssetKind[]).map((t) => <option key={t} value={t}>{KIND_LABEL[t]}</option>)}
                  </select>
                </label>
                <label className="block text-xs font-semibold">Platform
                  <input value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-border text-sm" placeholder="YouTube" />
                </label>
              </div>
              <label className="block text-xs font-semibold">Status
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as AssetStatus })} className="mt-1 w-full px-3 py-2 rounded-lg border border-border text-sm bg-card">
                  {(["Protected", "Monitoring", "At Risk"] as AssetStatus[]).map((t) => <option key={t}>{t}</option>)}
                </select>
              </label>
            </div>
            <div className="flex gap-2 mt-5 justify-end">
              <button onClick={() => setOpen(false)} className="px-4 py-2 rounded-lg border border-border text-sm font-medium">Cancel</button>
              <button
                disabled={!form.name.trim() || addMut.isPending}
                onClick={() => addMut.mutate()}
                className="px-4 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-60 inline-flex items-center gap-2"
                style={{ background: "var(--gradient-brand)" }}
              >
                {addMut.isPending && <Loader2 className="size-4 animate-spin" />}
                Register
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
