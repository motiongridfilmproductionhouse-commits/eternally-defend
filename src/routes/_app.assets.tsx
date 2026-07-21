import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Image as ImageIcon, Loader2, Plus, Search, Trash2, Upload, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { PageCard, Pill, StatCard } from "@/components/dashboard/PageCard";
import { prepareAssetUpload, registerAssetAndSearch } from "@/lib/asset-registration.functions";

export const Route = createFileRoute("/_app/assets")({
  head: () => ({ meta: [{ title: "Assets — Eterna AI" }] }), component: AssetsPage,
});

type AssetRow = { id: string; name: string; kind: string; source_url: string | null; active: boolean; metadata: any; storage_path: string | null; created_at: string };
type SearchResult = { matchCount: number; sha256: string; reverse: { pages: Array<{ url: string; title: string; fullMatches: number; partialMatches: number }>; fullMatchingImages: Array<{ url: string }>; partialMatchingImages: Array<{ url: string }>; visuallySimilarImages: Array<{ url: string }>; bestGuessLabels: string[] } };

function AssetsPage() {
  const { session, ready } = useSession();
  const userId = session?.user.id;
  const qc = useQueryClient();
  const prepare = useServerFn(prepareAssetUpload);
  const register = useServerFn(registerAssetAndSearch);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [platform, setPlatform] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);

  const query = useQuery({ queryKey: ["protected_assets", userId], enabled: ready && !!userId, queryFn: async () => {
    const { data, error } = await supabase.from("protected_assets").select("id,name,kind,source_url,active,metadata,storage_path,created_at").order("created_at", { ascending: false });
    if (error) throw error; return (data ?? []) as AssetRow[];
  }});

  const add = useMutation({ mutationFn: async () => {
    if (!file || !name.trim()) throw new Error("Choose an image and enter its name.");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Use a JPG, PNG or WebP image.");
    if (file.size > 10 * 1024 * 1024) throw new Error("Maximum image size is 10 MB.");
    const prepared = await prepare({ data: { fileName: file.name, contentType: file.type as "image/jpeg" | "image/png" | "image/webp", size: file.size } });
    const upload = await fetch(prepared.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
    if (!upload.ok) throw new Error(`Image upload failed (${upload.status}).`);
    return register({ data: { key: prepared.key, name: name.trim(), platform: platform.trim() || undefined, sourceUrl: sourceUrl.trim(), contentType: file.type as "image/jpeg" | "image/png" | "image/webp" } });
  }, onSuccess: (data) => {
    const scanName = name.trim();
    setResult(data as SearchResult); setOpen(false); setFile(null); setName(""); setPlatform(""); setSourceUrl("");
    qc.invalidateQueries({ queryKey: ["protected_assets", userId] }); toast.success(`Asset protected. ${data.matchCount} web matches found.`);
    const params = new URLSearchParams({ assetId: data.id, query: scanName, auto: "1" });
    window.location.assign(`/scan?${params.toString()}`);
  }, onError: (e: Error) => toast.error(e.message) });

  const remove = useMutation({ mutationFn: async (id: string) => { const { error } = await supabase.from("protected_assets").delete().eq("id", id); if (error) throw error; }, onSuccess: () => qc.invalidateQueries({ queryKey: ["protected_assets", userId] }) });
  const assets = query.data ?? [];
  const filtered = assets.filter(a => `${a.name} ${a.source_url ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const monitoring = assets.filter(a => a.metadata?.status === "Monitoring").length;
  const atRisk = assets.filter(a => Number(a.metadata?.reverse_search_match_count ?? 0) > 0).length;

  return <div className="space-y-5">
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <StatCard label="TOTAL ASSETS" value={assets.length} sub="Registered assets" />
      <StatCard label="PROTECTED" value={assets.length} sub="Fingerprint stored" accent="oklch(0.68 0.16 155)" />
      <StatCard label="MONITORING" value={monitoring} sub="Reverse searched" accent="oklch(0.75 0.16 70)" />
      <StatCard label="MATCHES FOUND" value={atRisk} sub="Assets with web matches" accent="oklch(0.63 0.24 25)" />
    </div>

    {result && <PageCard title="REVERSE SEARCH RESULTS" sub={`${result.matchCount} matching pages/images found`}>
      <div className="space-y-3">
        {result.reverse.bestGuessLabels.length > 0 && <div className="text-sm">Google identified: <b>{result.reverse.bestGuessLabels.join(", ")}</b></div>}
        {result.reverse.pages.length === 0 ? <div className="text-sm text-muted-foreground py-4">No matching public web pages found.</div> : result.reverse.pages.map((p, i) =>
          <a key={`${p.url}-${i}`} href={p.url} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl border border-border p-3 hover:bg-accent/40">
            <ImageIcon className="size-4 text-primary" /><div className="min-w-0 flex-1"><div className="font-medium truncate">{p.title}</div><div className="text-xs text-muted-foreground truncate">{p.url}</div></div><ExternalLink className="size-4" />
          </a>)}
      </div>
    </PageCard>}

    <PageCard title="ASSET REGISTRY" sub="Uploaded, fingerprinted and reverse searched assets" actions={<div className="flex gap-2">
      <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"/><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search assets..." className="pl-9 pr-3 py-2 rounded-lg border border-border bg-card text-sm w-56"/></div>
      <button onClick={() => setOpen(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold"><Plus className="size-4"/> Register Asset</button>
    </div>}>
      {query.isLoading ? <div className="py-16 grid place-items-center"><Loader2 className="animate-spin"/></div> : filtered.length === 0 ? <div className="py-16 text-center text-sm text-muted-foreground">No protected assets yet.</div> :
      <div className="space-y-2">{filtered.map(a => <div key={a.id} className="flex items-center gap-3 border-b border-border py-3">
        <div className="size-10 rounded-lg bg-primary/10 text-primary grid place-items-center"><ImageIcon className="size-5"/></div>
        <div className="flex-1 min-w-0"><div className="font-medium">{a.name}</div><div className="text-xs text-muted-foreground">{a.metadata?.reverse_search_match_count ?? 0} matches · {new Date(a.created_at).toLocaleDateString()}</div></div>
        <Pill color="oklch(0.75 0.16 70)">{a.metadata?.status ?? "Protected"}</Pill>
        <button onClick={() => confirm(`Delete ${a.name}?`) && remove.mutate(a.id)} className="size-8 grid place-items-center text-muted-foreground hover:text-destructive"><Trash2 className="size-4"/></button>
      </div>)}</div>}
    </PageCard>

    {open && <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={() => !add.isPending && setOpen(false)}><div className="card-surface p-6 w-full max-w-lg" onClick={e => e.stopPropagation()}>
      <div className="text-lg font-bold">Upload and protect an image</div><div className="text-sm text-muted-foreground mb-4">The image will be stored, fingerprinted and reverse searched.</div>
      <div className="space-y-3">
        <label className="block text-xs font-semibold">Image (JPG, PNG or WebP; maximum 10 MB)<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { const f=e.target.files?.[0] ?? null; setFile(f); if (f && !name) setName(f.name.replace(/\.[^.]+$/, "")); }} className="mt-1 block w-full text-sm"/></label>
        <label className="block text-xs font-semibold">Asset name<input value={name} onChange={e=>setName(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg border border-border"/></label>
        <label className="block text-xs font-semibold">Original source URL (optional)<input value={sourceUrl} onChange={e=>setSourceUrl(e.target.value)} placeholder="https://..." className="mt-1 w-full px-3 py-2 rounded-lg border border-border"/></label>
        <label className="block text-xs font-semibold">Platform (optional)<input value={platform} onChange={e=>setPlatform(e.target.value)} placeholder="Instagram, YouTube..." className="mt-1 w-full px-3 py-2 rounded-lg border border-border"/></label>
      </div>
      <div className="flex justify-end gap-2 mt-5"><button disabled={add.isPending} onClick={()=>setOpen(false)} className="px-4 py-2 border border-border rounded-lg">Cancel</button><button disabled={!file || !name.trim() || add.isPending} onClick={()=>add.mutate()} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-semibold inline-flex items-center gap-2 disabled:opacity-50">{add.isPending ? <Loader2 className="size-4 animate-spin"/> : <Upload className="size-4"/>}{add.isPending ? "Uploading & searching..." : "Upload & Reverse Search"}</button></div>
    </div></div>}
  </div>;
}
