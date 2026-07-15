import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { listEvidence, getEvidenceSignedUrl, deleteEvidence, uploadEvidence } from "@/lib/evidence-vault.functions";
import { Archive, Download, Trash2, Upload, Loader2 } from "lucide-react";
import { useRef, useState } from "react";

export const Route = createFileRoute("/_app/evidence-vault")({
  head: () => ({ meta: [{ title: "Evidence Vault · Eterna AI" }] }),
  component: EvidenceVault,
});

const KINDS = ["screenshot","takedown_package","certificate","thumbnail","archive","other"] as const;

function EvidenceVault() {
  const qc = useQueryClient();
  const listFn = useServerFn(listEvidence);
  const signFn = useServerFn(getEvidenceSignedUrl);
  const delFn = useServerFn(deleteEvidence);
  const upFn = useServerFn(uploadEvidence);
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<(typeof KINDS)[number]>("screenshot");

  const q = useQuery({ queryKey: ["evidence-vault"], queryFn: () => listFn({ data: {} }) });

  const uploadMut = useMutation({
    mutationFn: async (file: File) => {
      const buf = new Uint8Array(await file.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.byteLength; i++) bin += String.fromCharCode(buf[i]);
      const base64 = btoa(bin);
      return upFn({ data: { kind, base64, contentType: file.type || "application/octet-stream", label: file.name } });
    },
    onSuccess: () => { toast.success("Uploaded to Evidence Vault"); qc.invalidateQueries({ queryKey: ["evidence-vault"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => { toast.success("Removed"); qc.invalidateQueries({ queryKey: ["evidence-vault"] }); },
  });

  const download = async (id: string) => {
    const { url } = await signFn({ data: { id } });
    window.open(url, "_blank", "noopener");
  };

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center gap-3">
        <div className="size-10 rounded-xl grid place-items-center text-white" style={{ background: "var(--gradient-brand)" }}>
          <Archive className="size-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Evidence Vault</h1>
          <p className="text-xs text-muted-foreground">Server-encrypted evidence stored in Amazon S3 · signed download links (5 min TTL)</p>
        </div>
      </header>

      <section className="card-surface p-5 flex items-center gap-3">
        <select value={kind} onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])} className="text-xs border border-border rounded px-2 py-1.5 bg-background">
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMut.mutate(f); }} />
        <button onClick={() => fileRef.current?.click()} disabled={uploadMut.isPending}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-60"
          style={{ background: "var(--gradient-brand)" }}>
          {uploadMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Upload evidence
        </button>
        <span className="text-[11px] text-muted-foreground">Max 20 MB per file.</span>
      </section>

      <section className="card-surface p-5">
        {q.isLoading ? <Loader2 className="size-4 animate-spin" /> : (
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="text-left py-2">Label</th>
                <th className="text-left">Kind</th>
                <th className="text-left">Bytes</th>
                <th className="text-left">SHA-256</th>
                <th className="text-left">Uploaded</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(q.data ?? []).map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="py-2 truncate max-w-[220px]">{r.label ?? r.s3_key.split("/").pop()}</td>
                  <td>{r.kind}</td>
                  <td>{r.bytes ?? "—"}</td>
                  <td className="font-mono truncate max-w-[180px]">{r.sha256?.slice(0, 16) ?? "—"}</td>
                  <td>{new Date(r.created_at).toLocaleString()}</td>
                  <td className="text-right space-x-2">
                    <button onClick={() => download(r.id)} className="inline-flex items-center gap-1 text-primary"><Download className="size-3" /> Download</button>
                    <button onClick={() => delMut.mutate(r.id)} className="inline-flex items-center gap-1 text-destructive"><Trash2 className="size-3" /> Remove</button>
                  </td>
                </tr>
              ))}
              {q.data && q.data.length === 0 && (
                <tr><td colSpan={6} className="text-center text-muted-foreground py-6">Vault is empty.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
