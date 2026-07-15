import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { listFaceMatches, reviewFaceMatch } from "@/lib/face-scan.functions";
import { listProtectedFaces as listPFaces, deleteProtectedFace as delPFace } from "@/lib/face-protection.functions";
import { ShieldCheck, Trash2, ExternalLink, Loader2, ScanFace } from "lucide-react";

export const Route = createFileRoute("/_app/face-protection")({
  head: () => ({ meta: [{ title: "Face Protection · Eterna AI" }] }),
  component: FaceProtection,
});

const CATEGORIES = [
  { id: "impersonation", label: "Impersonation" },
  { id: "fake_endorsement", label: "Fake Endorsement" },
  { id: "unauthorized_image", label: "Unauthorized Image" },
  { id: "face_misuse", label: "Face Misuse" },
  { id: "celebrity_detection", label: "Celebrity Appearance" },
] as const;

function FaceProtection() {
  const qc = useQueryClient();
  const listMatchesFn = useServerFn(listFaceMatches);
  const reviewFn = useServerFn(reviewFaceMatch);
  const listFacesFn = useServerFn(listPFaces);
  const delFn = useServerFn(delPFace);

  const [status, setStatus] = useState<"pending" | "authorized" | "harmless" | "threat_created" | "dismissed">("pending");

  const facesQuery = useQuery({
    queryKey: ["protected-faces"],
    queryFn: () => listFacesFn(),
  });
  const matchesQuery = useQuery({
    queryKey: ["face-matches", status],
    queryFn: () => listMatchesFn({ data: { status, limit: 100 } }),
  });

  const reviewMut = useMutation({
    mutationFn: (v: { id: string; decision: "authorized" | "harmless" | "threat_created" | "dismissed"; category?: (typeof CATEGORIES)[number]["id"]; notes: string }) =>
      reviewFn({ data: v }),
    onSuccess: () => {
      toast.success("Match reviewed");
      qc.invalidateQueries({ queryKey: ["face-matches"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => { toast.success("Face removed"); qc.invalidateQueries({ queryKey: ["protected-faces"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center gap-3">
        <div className="size-10 rounded-xl grid place-items-center text-white" style={{ background: "var(--gradient-brand)" }}>
          <ScanFace className="size-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Face Protection</h1>
          <p className="text-xs text-muted-foreground">AWS Rekognition-backed facial protection & review workflow</p>
        </div>
      </header>

      <section className="card-surface p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Protected Faces ({facesQuery.data?.length ?? 0})</h2>
          <span className="text-[11px] text-muted-foreground">Faces are indexed automatically when you confirm an official account or add asset images.</span>
        </div>
        {facesQuery.isLoading ? <Loader2 className="size-4 animate-spin" /> : (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {(facesQuery.data ?? []).map((f) => (
              <div key={f.id} className="rounded-lg border border-border p-3 text-xs space-y-1">
                <div className="font-medium truncate">{f.label ?? "Reference"}</div>
                <div className="text-muted-foreground truncate">{f.platform ?? "asset"}</div>
                <div className="text-[10px] text-muted-foreground truncate">conf {Math.round(Number(f.confidence ?? 0))}%</div>
                <button onClick={() => deleteMut.mutate(f.id)} className="inline-flex items-center gap-1 text-destructive text-[11px] mt-1">
                  <Trash2 className="size-3" /> Remove
                </button>
              </div>
            ))}
            {facesQuery.data && facesQuery.data.length === 0 && (
              <div className="col-span-full text-xs text-muted-foreground py-4 text-center">No protected faces yet.</div>
            )}
          </div>
        )}
      </section>

      <section className="card-surface p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold flex items-center gap-2"><ShieldCheck className="size-4" /> Face Match Review Queue</h2>
          <div className="flex gap-1">
            {(["pending","authorized","harmless","threat_created","dismissed"] as const).map((s) => (
              <button key={s} onClick={() => setStatus(s)}
                className={`px-2.5 py-1 rounded text-[11px] font-medium ${status===s?"bg-primary text-primary-foreground":"bg-muted"}`}>
                {s.replace("_"," ")}
              </button>
            ))}
          </div>
        </div>

        {matchesQuery.isLoading ? <Loader2 className="size-4 animate-spin" /> : (
          <div className="space-y-3">
            {(matchesQuery.data ?? []).map((m) => (
              <MatchRow key={m.id} m={m} onDecide={(dec, cat, notes) => reviewMut.mutate({ id: m.id, decision: dec, category: cat, notes })} />
            ))}
            {matchesQuery.data && matchesQuery.data.length === 0 && (
              <div className="text-xs text-muted-foreground text-center py-6">No matches in this bucket.</div>
            )}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground mt-4">
          A face match alone never creates a threat. To create a threat you must set a category and provide review notes (similarity ≥ 80 required).
        </p>
      </section>
    </div>
  );
}

interface MatchRow {
  id: string;
  similarity: number | null;
  face_confidence: number | null;
  source_url: string | null;
  source_type: string | null;
  review_status: string;
  threat_category: string | null;
  context_notes: string | null;
  created_at: string;
  signed_url?: string;
}

function MatchRow({ m, onDecide }: { m: MatchRow; onDecide: (d: "authorized" | "harmless" | "threat_created" | "dismissed", cat: (typeof CATEGORIES)[number]["id"] | undefined, notes: string) => void }) {
  const [notes, setNotes] = useState("");
  const [cat, setCat] = useState<(typeof CATEGORIES)[number]["id"]>("impersonation");

  return (
    <div className="rounded-lg border border-border p-3 grid md:grid-cols-[120px_1fr_auto] gap-3">
      {m.signed_url ? (
        <img src={m.signed_url} alt="match" className="size-[120px] rounded-md object-cover" />
      ) : (
        <div className="size-[120px] rounded-md bg-muted grid place-items-center text-[10px] text-muted-foreground">no preview</div>
      )}
      <div className="min-w-0 text-xs space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm">{Math.round(Number(m.similarity ?? 0))}%</span>
          <span className="text-muted-foreground">match · {m.source_type}</span>
        </div>
        {m.source_url && (
          <a href={m.source_url} target="_blank" rel="noreferrer" className="text-primary underline break-all inline-flex items-center gap-1">
            {m.source_url.slice(0, 90)} <ExternalLink className="size-3 shrink-0" />
          </a>
        )}
        <div className="text-muted-foreground text-[10px]">face conf {Math.round(Number(m.face_confidence ?? 0))}% · {new Date(m.created_at).toLocaleString()}</div>
        {m.review_status === "pending" && (
          <div className="mt-2 flex flex-wrap gap-2 items-center">
            <select value={cat} onChange={(e) => setCat(e.target.value as (typeof CATEGORIES)[number]["id"])} className="text-xs border border-border rounded px-2 py-1 bg-background">
              {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Context notes (required)"
              className="flex-1 min-w-[200px] text-xs border border-border rounded px-2 py-1 bg-background" />
          </div>
        )}
        {m.review_status !== "pending" && (
          <div className="text-[11px] mt-1"><span className="font-semibold uppercase">{m.review_status}</span>{m.threat_category ? ` · ${m.threat_category}` : ""}{m.context_notes ? ` — ${m.context_notes}` : ""}</div>
        )}
      </div>
      {m.review_status === "pending" && (
        <div className="flex flex-col gap-1 self-center">
          <button disabled={!notes} onClick={() => onDecide("authorized", undefined, notes || "authorized use")} className="text-[11px] px-2 py-1 rounded bg-emerald-600 text-white disabled:opacity-40">Authorized</button>
          <button disabled={!notes} onClick={() => onDecide("harmless", undefined, notes || "no harm")} className="text-[11px] px-2 py-1 rounded bg-secondary disabled:opacity-40">Harmless</button>
          <button disabled={!notes} onClick={() => onDecide("threat_created", cat, notes)} className="text-[11px] px-2 py-1 rounded bg-destructive text-destructive-foreground disabled:opacity-40">Create Threat</button>
          <button disabled={!notes} onClick={() => onDecide("dismissed", undefined, notes || "dismissed")} className="text-[11px] px-2 py-1 rounded bg-muted disabled:opacity-40">Dismiss</button>
        </div>
      )}
    </div>
  );
}
